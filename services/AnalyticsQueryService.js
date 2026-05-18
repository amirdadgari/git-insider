const moment = require('moment');
const Database = require('../config/database');
const CommitIndexer = require('./CommitIndexer');
const ContributorService = require('./ContributorService');

class AnalyticsQueryService {
    constructor(db = null, gitService = null) {
        this.db = db || new Database();
        this.gitService = gitService;
        this.indexer = new CommitIndexer(this.db, gitService);
        this.contributors = new ContributorService(this.db);
    }

    setGitService(gitService) {
        this.gitService = gitService;
        this.indexer.setGitService(gitService);
    }

    likeOp() {
        return this.db.likeOp ? this.db.likeOp() : 'LIKE';
    }

    async _repoFilter(includeUnnamed, repositoryIds) {
        let sql = 'SELECT id, path, name, display_name, folder_name, scm_fullpath FROM git_repositories WHERE is_active = 1';
        const params = [];

        if (repositoryIds && repositoryIds.length) {
            const placeholders = repositoryIds.map(() => '?').join(',');
            sql += ` AND id IN (${placeholders})`;
            params.push(...repositoryIds);
        }

        const repos = await this.db.all(sql, params);

        if (includeUnnamed) return repos;

        return repos.filter((r) => {
            if (r.display_name) return true;
            if (r.scm_fullpath) return true;
            return !r.scm_fullpath && r.name;
        });
    }

    async _ensureIndexed(repos, startDate, endDate) {
        for (const repo of repos) {
            await this.indexer.ensureRangeIndexed(repo.id, repo.path, startDate, endDate);
        }
        await this.indexer.touchAccessForRepos(repos.map((r) => r.id));
    }

    _buildCommitWhere(filters, params) {
        const clauses = ['1=1'];
        const {
            userPattern,
            contributorId,
            contributorIds,
            hash,
            message,
            startDate,
            endDate,
            branch,
            repositoryIds
        } = filters;

        if (repositoryIds && repositoryIds.length) {
            clauses.push(`c.repository_id IN (${repositoryIds.map(() => '?').join(',')})`);
            params.push(...repositoryIds);
        }

        if (contributorId) {
            clauses.push('c.contributor_id = ?');
            params.push(contributorId);
        }

        if (contributorIds && contributorIds.length) {
            clauses.push(`c.contributor_id IN (${contributorIds.map(() => '?').join(',')})`);
            params.push(...contributorIds);
        }

        if (userPattern) {
            const like = this.likeOp();
            clauses.push(`(c.author_name ${like} ? OR c.author_email ${like} ? OR EXISTS (
                SELECT 1 FROM contributors ct WHERE ct.id = c.contributor_id AND ct.display_name ${like} ?
            ))`);
            const pat = `%${userPattern}%`;
            params.push(pat, pat, pat);
        }

        if (hash) {
            const like = this.likeOp();
            clauses.push(`c.hash ${like} ?`);
            params.push(`${hash}%`);
        }

        if (message) {
            const like = this.likeOp();
            clauses.push(`c.message ${like} ?`);
            params.push(`%${message}%`);
        }

        if (startDate) {
            clauses.push('c.committed_at >= ?');
            params.push(startDate);
        }

        if (endDate) {
            clauses.push('c.committed_at <= ?');
            params.push(moment(endDate).endOf('day').toISOString());
        }

        if (branch) {
            const like = this.likeOp();
            clauses.push(`c.branch ${like} ?`);
            params.push(branch);
        }

        return clauses.join(' AND ');
    }

    async queryCommits(options = {}) {
        const {
            userPattern,
            contributorId,
            contributorIds,
            hash,
            message,
            startDate,
            endDate,
            repositoryIds,
            branch,
            includeUnnamed = false,
            includeChanges = false,
            noCache = false,
            page = 1,
            limit = 50
        } = options;

        if (noCache && this.gitService) {
            return this._fallbackLiveCommits(options);
        }

        const repos = await this._repoFilter(includeUnnamed, repositoryIds);
        if (!repos.length) {
            return { commits: [], pagination: { page, limit, total: 0, totalPages: 0 } };
        }

        const repoIds = repos.map((r) => r.id);
        await this._ensureIndexed(repos, startDate, endDate);

        const params = [];
        const where = this._buildCommitWhere(
            {
                userPattern,
                contributorId,
                contributorIds,
                hash,
                message,
                startDate,
                endDate,
                branch,
                repositoryIds: repoIds
            },
            params
        );

        const countRow = await this.db.get(
            `SELECT COUNT(*) AS total FROM commits c WHERE ${where}`,
            params
        );
        const total = countRow?.total || 0;
        const pg = Math.max(1, page);
        const lm = Math.max(1, limit);
        const offset = (pg - 1) * lm;

        const rows = await this.db.all(`
            SELECT c.*, r.name AS repo_name, r.display_name, r.path AS repo_path,
                ct.display_name AS contributor_name
            FROM commits c
            JOIN git_repositories r ON r.id = c.repository_id
            LEFT JOIN contributors ct ON ct.id = c.contributor_id
            WHERE ${where}
            ORDER BY c.committed_at DESC
            LIMIT ? OFFSET ?
        `, [...params, lm, offset]);

        const commits = rows.map((row) => ({
            repository: row.display_name || row.repo_name,
            repositoryId: row.repository_id,
            repositoryPath: row.repo_path,
            hash: row.hash,
            author: row.author_name,
            authorEmail: row.author_email,
            contributorId: row.contributor_id,
            contributorName: row.contributor_name,
            date: row.committed_at,
            message: row.message,
            branch: row.branch,
            files: []
        }));

        if (includeChanges) {
            for (const commit of commits) {
                const dbRow = rows.find((r) => r.hash === commit.hash);
                let files = await this.db.all(
                    'SELECT filename, additions, deletions FROM commit_files WHERE commit_id = ?',
                    [dbRow.id]
                );
                if (!files.length) {
                    await this.indexer.indexCommitFiles(dbRow.id, commit.repositoryPath, commit.hash);
                    files = await this.db.all(
                        'SELECT filename, additions, deletions FROM commit_files WHERE commit_id = ?',
                        [dbRow.id]
                    );
                }
                commit.files = files;
            }
        }

        return {
            commits,
            pagination: {
                page: pg,
                limit: lm,
                total,
                totalPages: Math.ceil(total / lm) || 0
            }
        };
    }

    async _fallbackLiveCommits(options) {
        if (!this.gitService) {
            return { commits: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
        }
        const {
            userPattern,
            startDate,
            endDate,
            includeUnnamed,
            branch,
            includeChanges,
            page = 1,
            limit = 50
        } = options;

        const pg = Math.max(1, page);
        const lm = Math.max(1, limit);
        const earlyLimit = pg * lm;

        let commits = await this.gitService.getCommitsFromWorkspaces(
            userPattern,
            startDate,
            endDate,
            includeUnnamed,
            { limit: earlyLimit, noCache: true, branch, includeChanges }
        );

        const total = commits.length;
        const offset = (pg - 1) * lm;
        commits = commits.slice(offset, offset + lm);

        return {
            commits,
            pagination: { page: pg, limit: lm, total, totalPages: Math.ceil(total / lm) || 0 }
        };
    }

    async queryCodeChanges(options = {}) {
        const result = await this.queryCommits({ ...options, includeChanges: true, limit: options.limit || 50 });
        const changes = result.commits.map((c) => ({
            repository: c.repository,
            repositoryId: c.repositoryId,
            hash: c.hash,
            author: c.author,
            email: c.authorEmail,
            date: c.date,
            message: c.message,
            files: c.files || []
        }));
        return { changes, pagination: result.pagination };
    }

    async getAnalyticsSummary(startDate, endDate, repositoryIds, contributorIds) {
        const repos = await this._repoFilter(true, repositoryIds);
        if (!repos.length) {
            return this._emptyAnalytics();
        }

        await this._ensureIndexed(repos, startDate, endDate);
        const repoIds = repos.map((r) => r.id);

        const start = startDate || moment().subtract(3, 'months').format('YYYY-MM-DD');
        const end = endDate ? moment(endDate).endOf('day').toISOString() : moment().endOf('day').toISOString();
        const repoClause = `c.repository_id IN (${repoIds.map(() => '?').join(',')})`;

        let contributorClause = '';
        const contributorParams = [];
        if (contributorIds && contributorIds.length) {
            contributorClause = ` AND c.contributor_id IN (${contributorIds.map(() => '?').join(',')})`;
            contributorParams.push(...contributorIds);
        }

        const rangeParams = [start, end, ...repoIds, ...contributorParams];
        const dateFilter = 'c.committed_at >= ? AND c.committed_at <= ?';

        const recentCommits = await this.db.all(`
            SELECT c.*, r.display_name, r.name AS repo_name, r.path AS repo_path,
                ct.display_name AS contributor_name
            FROM commits c
            JOIN git_repositories r ON r.id = c.repository_id
            LEFT JOIN contributors ct ON ct.id = c.contributor_id
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
            ORDER BY c.committed_at DESC
            LIMIT 20
        `, rangeParams);

        const topContributors = await this.db.all(`
            SELECT COALESCE(ct.display_name, c.author_name, 'Unknown') AS name,
                c.contributor_id,
                COUNT(*) AS commit_count
            FROM commits c
            LEFT JOIN contributors ct ON ct.id = c.contributor_id
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
            GROUP BY c.contributor_id, ct.display_name, c.author_name
            ORDER BY commit_count DESC
            LIMIT 10
        `, rangeParams);

        const topRepositories = await this.db.all(`
            SELECT COALESCE(r.display_name, r.name) AS name, c.repository_id, COUNT(*) AS commit_count
            FROM commits c
            JOIN git_repositories r ON r.id = c.repository_id
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
            GROUP BY c.repository_id, r.display_name, r.name
            ORDER BY commit_count DESC
            LIMIT 10
        `, rangeParams);

        const filesChanged = await this.db.get(`
            SELECT COUNT(*) AS total FROM commit_files cf
            JOIN commits c ON c.id = cf.commit_id
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
        `, rangeParams);

        const linesTotals = await this.db.get(`
            SELECT COALESCE(SUM(cf.additions), 0) AS additions, COALESCE(SUM(cf.deletions), 0) AS deletions
            FROM commit_files cf
            JOIN commits c ON c.id = cf.commit_id
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
        `, rangeParams);

        const commitsOverTime = await this.db.all(`
            SELECT substr(c.committed_at, 1, 10) AS bucket, COUNT(*) AS count
            FROM commits c
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
            GROUP BY bucket
            ORDER BY bucket
        `, rangeParams);

        const linesOverTime = await this.db.all(`
            SELECT substr(c.committed_at, 1, 10) AS bucket,
                COALESCE(SUM(cf.additions), 0) AS additions,
                COALESCE(SUM(cf.deletions), 0) AS deletions
            FROM commit_files cf
            JOIN commits c ON c.id = cf.commit_id
            WHERE ${repoClause} AND ${dateFilter}${contributorClause}
            GROUP BY bucket
            ORDER BY bucket
        `, rangeParams);

        return {
            recentCommits: recentCommits.map((row) => ({
                repository: row.display_name || row.repo_name,
                repositoryId: row.repository_id,
                repositoryPath: row.repo_path,
                hash: row.hash,
                author: row.author_name,
                authorEmail: row.author_email,
                contributorId: row.contributor_id,
                contributorName: row.contributor_name,
                date: row.committed_at,
                message: row.message
            })),
            topContributors,
            topRepositories,
            filesChanged: filesChanged?.total || 0,
            totalAdditions: linesTotals?.additions || 0,
            totalDeletions: linesTotals?.deletions || 0,
            commitsOverTime,
            linesOverTime
        };
    }

    _emptyAnalytics() {
        return {
            recentCommits: [],
            topContributors: [],
            topRepositories: [],
            filesChanged: 0,
            totalAdditions: 0,
            totalDeletions: 0,
            commitsOverTime: [],
            linesOverTime: []
        };
    }
}

module.exports = AnalyticsQueryService;
