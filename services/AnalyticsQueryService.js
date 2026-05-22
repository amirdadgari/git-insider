const moment = require('moment');
const Database = require('../config/database');
const CommitIndexer = require('./CommitIndexer');
const ContributorService = require('./ContributorService');
const {
    resolveUserFilter,
    normalizeRangeDates,
    likeContains,
    escapeLikePattern
} = require('../lib/userFilter');
const { createQueryTimer } = require('../lib/queryTiming');

class AnalyticsQueryService {
    constructor(db = null, gitService = null, indexer = null) {
        this.db = db || new Database();
        this.gitService = gitService;
        this.indexer = indexer || new CommitIndexer(this.db, gitService);
        this.contributors = new ContributorService(this.db);
    }

    setGitService(gitService) {
        this.gitService = gitService;
        if (gitService && gitService.indexer) {
            this.indexer = gitService.indexer;
        }
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
        await this.indexer.ensureRangesIndexed(repos, startDate, endDate);
        await this.indexer.touchAccessForRepos(repos.map((r) => r.id));
    }

    _appendUserIdentifiersClause(clauses, params, userIdentifiers) {
        if (!userIdentifiers || !userIdentifiers.length) return;

        const emails = [];
        const others = [];
        for (const identifier of userIdentifiers) {
            if (String(identifier).includes('@')) {
                emails.push(identifier);
            } else {
                others.push(identifier);
            }
        }

        const parts = [];

        if (emails.length) {
            const emailPh = emails.map(() => '?').join(',');
            parts.push(`c.author_email IN (${emailPh})`);
            params.push(...emails);
            parts.push(
                `c.contributor_id IN (SELECT contributor_id FROM contributor_aliases WHERE author_email IN (${emailPh}))`
            );
            params.push(...emails);
        }

        if (others.length) {
            const like = this.likeOp();
            for (const identifier of others) {
                parts.push(`(c.author_name = ? OR c.author_email = ? OR EXISTS (
                    SELECT 1 FROM contributors ct WHERE ct.id = c.contributor_id AND ct.display_name = ?
                ) OR EXISTS (
                    SELECT 1 FROM contributor_aliases ca
                    WHERE ca.contributor_id = c.contributor_id
                      AND (ca.author_name = ? OR ca.author_email = ?)
                ))`);
                params.push(identifier, identifier, identifier, identifier, identifier);
            }
        }

        clauses.push(`(${parts.join(' OR ')})`);
    }

    _buildCommitWhere(filters, params) {
        const clauses = ['1=1'];
        const {
            userIdentifiers,
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

        this._appendUserIdentifiersClause(clauses, params, userIdentifiers);

        if (hash) {
            const like = this.likeOp();
            clauses.push(`c.hash ${like} ? ESCAPE '\\'`);
            params.push(`${escapeLikePattern(hash)}%`);
        }

        if (message) {
            const like = this.likeOp();
            clauses.push(`c.message ${like} ? ESCAPE '\\'`);
            params.push(likeContains(message));
        }

        if (startDate) {
            clauses.push('c.committed_at >= ?');
            params.push(startDate);
        }

        if (endDate) {
            clauses.push('c.committed_at <= ?');
            params.push(endDate);
        }

        if (branch) {
            const like = this.likeOp();
            clauses.push(`c.branch ${like} ?`);
            params.push(branch);
        }

        return clauses.join(' AND ');
    }

    async queryCommits(options = {}) {
        const timer = createQueryTimer('queryCommits');
        const {
            contributorId,
            contributorIds,
            hash,
            message,
            repositoryIds,
            branch,
            includeUnnamed = false,
            includeChanges = false,
            noCache = false,
            page = 1,
            limit = 50
        } = options;

        const { identifiers: userIdentifiers, gitAuthorPattern } = resolveUserFilter(options);
        const { startDate, endDate } = normalizeRangeDates(options.startDate, options.endDate);
        timer.mark('resolveFilters', { users: userIdentifiers.length, includeChanges, noCache });

        if (noCache && this.gitService) {
            const result = await this._fallbackLiveCommits({
                ...options,
                userIdentifiers,
                gitAuthorPattern,
                startDate,
                endDate
            });
            timer.finish({ path: 'live', commits: result.commits.length });
            return result;
        }

        const repos = await this._repoFilter(includeUnnamed, repositoryIds);
        timer.mark('repoFilter', { repos: repos.length });
        if (!repos.length) {
            timer.finish({ commits: 0, total: 0 });
            return {
                commits: [],
                indexing: false,
                enqueued: 0,
                pagination: { page, limit, total: 0, totalPages: 0, indexing: false, enqueued: 0 }
            };
        }

        const repoIds = repos.map((r) => r.id);
        const indexMeta = await this.indexer.ensureRangesIndexed(repos, options.startDate, options.endDate);
        timer.mark('ensureRangesIndexed', indexMeta);
        await this.indexer.touchAccessForRepos(repoIds);
        timer.mark('touchAccessForRepos', { repos: repoIds.length });

        const params = [];
        const where = this._buildCommitWhere(
            {
                userIdentifiers,
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
        timer.mark('buildWhere');

        const pg = Math.max(1, page);
        const lm = Math.max(1, limit);
        const offset = (pg - 1) * lm;

        const rows = await this.db.all(`
            SELECT c.id, c.repository_id, c.hash, c.author_name, c.author_email,
                c.contributor_id, c.committed_at, c.message, c.branch, c.files_indexed_at,
                r.name AS repo_name, r.display_name, r.path AS repo_path,
                ct.display_name AS contributor_name,
                COUNT(*) OVER() AS _total
            FROM commits c
            JOIN git_repositories r ON r.id = c.repository_id
            LEFT JOIN contributors ct ON ct.id = c.contributor_id
            WHERE ${where}
            ORDER BY c.committed_at DESC
            LIMIT ? OFFSET ?
        `, [...params, lm, offset]);
        timer.mark('selectCommits', { rows: rows.length });

        const total = rows.length ? (rows[0]._total || 0) : 0;

        const commits = rows.map((row) => ({
            id: row.id,
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
            timer.mark('includeChangesStart');
            const commitIds = rows.map((r) => r.id);
            const placeholders = commitIds.map(() => '?').join(',');
            const allFiles = commitIds.length
                ? await this.db.all(
                    `SELECT commit_id, filename, additions, deletions FROM commit_files WHERE commit_id IN (${placeholders})`,
                    commitIds
                )
                : [];

            const filesByCommitId = new Map();
            for (const f of allFiles) {
                if (!filesByCommitId.has(f.commit_id)) filesByCommitId.set(f.commit_id, []);
                filesByCommitId.get(f.commit_id).push({ filename: f.filename, additions: f.additions, deletions: f.deletions });
            }

            const unindexed = rows.filter((r) => !r.files_indexed_at);
            if (unindexed.length) {
                await Promise.all(
                    unindexed.map((r) => this.indexer.indexCommitFiles(r.id, r.repo_path, r.hash))
                );
                const unindexedIds = unindexed.map((r) => r.id);
                const newFiles = await this.db.all(
                    `SELECT commit_id, filename, additions, deletions FROM commit_files WHERE commit_id IN (${unindexedIds.map(() => '?').join(',')})`,
                    unindexedIds
                );
                for (const f of newFiles) {
                    if (!filesByCommitId.has(f.commit_id)) filesByCommitId.set(f.commit_id, []);
                    filesByCommitId.get(f.commit_id).push({ filename: f.filename, additions: f.additions, deletions: f.deletions });
                }
            }

            for (const commit of commits) {
                commit.files = filesByCommitId.get(commit.id) || [];
            }
            timer.mark('includeChangesDone', { commits: commits.length });
        }

        const indexing = (indexMeta.enqueued || 0) > 0;
        const result = {
            commits,
            indexing,
            enqueued: indexMeta.enqueued || 0,
            pagination: {
                page: pg,
                limit: lm,
                total,
                totalPages: Math.ceil(total / lm) || 0,
                indexing,
                enqueued: indexMeta.enqueued || 0
            }
        };
        timer.finish({
            path: 'db',
            repos: repos.length,
            commits: commits.length,
            total,
            page: pg,
            limit: lm
        });
        return result;
    }

    async _fallbackLiveCommits(options) {
        if (!this.gitService) {
            return {
                commits: [],
                indexing: false,
                enqueued: 0,
                pagination: { page: 1, limit: 50, total: 0, totalPages: 0, indexing: false, enqueued: 0 }
            };
        }
        const {
            gitAuthorPattern,
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
            gitAuthorPattern,
            startDate,
            endDate,
            includeUnnamed,
            { limit: earlyLimit, noCache: true, branch, includeChanges }
        );

        const cappedTotal = commits.length;
        const offset = (pg - 1) * lm;
        commits = commits.slice(offset, offset + lm);

        return {
            commits,
            indexing: false,
            enqueued: 0,
            pagination: {
                page: pg,
                limit: lm,
                total: cappedTotal,
                totalPages: Math.ceil(cappedTotal / lm) || 0,
                indexing: false,
                enqueued: 0,
                capped: true
            }
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

        const start = startDate
            ? moment(startDate).startOf('day').toISOString()
            : moment().subtract(3, 'months').startOf('day').toISOString();
        const end = endDate
            ? moment(endDate).endOf('day').toISOString()
            : moment().endOf('day').toISOString();
        const repoClause = `c.repository_id IN (${repoIds.map(() => '?').join(',')})`;

        let contributorClause = '';
        const contributorParams = [];
        if (contributorIds && contributorIds.length) {
            contributorClause = ` AND c.contributor_id IN (${contributorIds.map(() => '?').join(',')})`;
            contributorParams.push(...contributorIds);
        }

        const rangeParams = [...repoIds, start, end, ...contributorParams];
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
