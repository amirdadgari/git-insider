const moment = require('moment');
const simpleGit = require('simple-git');
const Database = require('../config/database');
const SettingsService = require('./SettingsService');
const ContributorService = require('./ContributorService');
const IndexProgress = require('./IndexProgress');

const BATCH_SIZE = Math.max(20, parseInt(process.env.INDEX_BATCH_SIZE || '80', 10));

class CommitIndexer {
    constructor(db = null, gitService = null) {
        this.db = db || new Database();
        this.settings = new SettingsService(this.db);
        this.contributors = new ContributorService(this.db);
        this.gitService = gitService;
        this.gitConcurrency = Math.max(1, parseInt(process.env.GIT_CONCURRENCY || '8', 10));
        this.excludeMerges = String(process.env.GIT_EXCLUDE_MERGES || 'true').toLowerCase() === 'true';
        this.indexCommitBranch = String(process.env.INDEX_COMMIT_BRANCH || 'true').toLowerCase() === 'true';
        this._jobPromise = null;
        this._pendingQueue = [];
    }

    setGitService(gitService) {
        this.gitService = gitService;
    }

    getProgress() {
        return IndexProgress.snapshot();
    }

    async _getGit(repoPath) {
        if (this.gitService && typeof this.gitService._getGitForPath === 'function') {
            return this.gitService._getGitForPath(repoPath);
        }
        const git = simpleGit(repoPath);
        await git.raw(['rev-parse', '--git-dir']);
        return git;
    }

    /**
     * Schedule indexing without blocking the caller (queries use partial index).
     */
    scheduleIndexing(repos, startDate, endDate) {
        if (!repos || !repos.length) return;
        const tasks = repos.map((repo) => ({
            repositoryId: repo.id,
            repoPath: repo.path,
            repoName: repo.display_name || repo.name,
            startDate,
            endDate
        }));
        this._enqueueTasks(tasks);
    }

    _enqueueTasks(tasks) {
        this._pendingQueue.push(...tasks);
        this._drainQueue();
    }

    _drainQueue() {
        if (this._jobPromise) return;
        if (!this._pendingQueue.length) return;

        const batch = [...this._pendingQueue];
        this._pendingQueue = [];

        this._jobPromise = this._runJob(batch)
            .catch((err) => {
                console.error('[indexer] Job failed:', err);
                IndexProgress.fail(err);
            })
            .finally(() => {
                this._jobPromise = null;
                if (this._pendingQueue.length) {
                    this._drainQueue();
                } else {
                    const snap = IndexProgress.snapshot();
                    if (snap.phase === 'indexing') {
                        IndexProgress.complete(
                            `Indexed ${snap.commitsIndexed} new commits`
                        );
                    }
                }
            });
    }

    async _runJob(tasks) {
        const unique = new Map();
        for (const t of tasks) {
            unique.set(`${t.repositoryId}:${t.startDate || ''}:${t.endDate || ''}`, t);
        }
        const list = [...unique.values()];

        if (!IndexProgress.isActive()) {
            IndexProgress.start({ reposTotal: list.length, message: 'Indexing commits (newest first)…' });
        } else {
            IndexProgress.addRepos(list.length);
        }

        let repoIndex = IndexProgress.snapshot().reposCompleted;

        for (const task of list) {
            const sinceIso = task.startDate
                ? moment(task.startDate).toISOString()
                : moment().subtract(await this.settings.getIndexWindowMonths(), 'months').toISOString();
            const endIso = task.endDate
                ? moment(task.endDate).endOf('day').toISOString()
                : moment().toISOString();

            IndexProgress.setRepository(task.repositoryId, task.repoName, repoIndex);
            await this._indexRepositoryNewestFirst(task.repositoryId, task.repoPath, sinceIso, endIso);
            IndexProgress.completeRepository();
            repoIndex += 1;
        }
    }

    async indexWorkspace(workspaceId) {
        const workspace = await this.db.get('SELECT * FROM workspaces WHERE id = ? AND is_active = 1', [workspaceId]);
        if (!workspace) return { indexed: 0, started: false };

        const repos = await this.db.all(`
            SELECT id, path, name, display_name
            FROM git_repositories
            WHERE is_active = 1 AND path LIKE ?
        `, [`${workspace.root_path}%`]);

        const months = await this.settings.getIndexWindowMonths();
        const startDate = moment().subtract(months, 'months').format('YYYY-MM-DD');
        this.scheduleIndexing(repos, startDate, null);
        return { started: true, repos: repos.length };
    }

    async indexAllActiveRepos() {
        const repos = await this.db.all(
            'SELECT id, path, name, display_name FROM git_repositories WHERE is_active = 1'
        );
        const months = await this.settings.getIndexWindowMonths();
        const startDate = moment().subtract(months, 'months').format('YYYY-MM-DD');
        this.scheduleIndexing(repos, startDate, null);
        return { started: true, repos: repos.length };
    }

    /**
     * Check index coverage for many repos in two queries (not N per repo).
     * @param {{ id: number, path: string, name?: string, display_name?: string }[]} repos
     */
    async ensureRangesIndexed(repos, startDate, endDate) {
        if (!repos.length) return { enqueued: 0 };

        const months = await this.settings.getIndexWindowMonths();
        const start = startDate
            ? moment(startDate).startOf('day')
            : moment().subtract(months, 'months').startOf('day');
        const end = endDate ? moment(endDate).endOf('day') : moment();

        const ids = repos.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const coverages = await this.db.all(
            `SELECT * FROM index_coverage WHERE repository_id IN (${placeholders})`,
            ids
        );
        const coverageByRepo = new Map(coverages.map((c) => [c.repository_id, c]));

        const tasks = [];
        for (const repo of repos) {
            const coverage = coverageByRepo.get(repo.id);
            const repoName = repo.display_name || repo.name;
            const base = {
                repositoryId: repo.id,
                repoPath: repo.path,
                repoName
            };

            if (!coverage) {
                tasks.push({
                    ...base,
                    startDate: start.toISOString(),
                    endDate: end.toISOString()
                });
                continue;
            }

            if (coverage.oldest_indexed_at && start.isBefore(moment(coverage.oldest_indexed_at))) {
                tasks.push({
                    ...base,
                    startDate: start.toISOString(),
                    endDate: moment(coverage.oldest_indexed_at).subtract(1, 'second').toISOString()
                });
            }

            if (!coverage.newest_indexed_at || end.isAfter(moment(coverage.newest_indexed_at))) {
                const since = coverage.newest_indexed_at
                    ? moment(coverage.newest_indexed_at).toISOString()
                    : start.toISOString();
                tasks.push({
                    ...base,
                    startDate: since,
                    endDate: end.toISOString()
                });
            }
        }

        if (tasks.length) {
            this._enqueueTasks(tasks);
        }

        return { enqueued: tasks.length };
    }

    async ensureRangeIndexed(repositoryId, repoPath, startDate, endDate) {
        const repo = await this.db.get(
            'SELECT id, path, name, display_name FROM git_repositories WHERE id = ?',
            [repositoryId]
        );
        if (!repo) return;
        await this.ensureRangesIndexed(
            [{ id: repo.id, path: repoPath || repo.path, name: repo.name, display_name: repo.display_name }],
            startDate,
            endDate
        );
    }

    /**
     * Index commits newest-first in batches so recent data is queryable quickly.
     */
    async _indexRepositoryNewestFirst(repositoryId, repoPath, sinceIso, untilIso) {
        try {
            const git = await this._getGit(repoPath);
            const since = moment(sinceIso);
            let until = untilIso ? moment(untilIso) : moment();
            let totalNew = 0;
            let totalSkipped = 0;

            while (until.isAfter(since)) {
                const logOpts = {
                    '--all': true,
                    '--since': since.toISOString(),
                    '--until': until.toISOString(),
                    '--max-count': BATCH_SIZE,
                    format: {
                        hash: '%H',
                        author: '%an',
                        authorEmail: '%ae',
                        date: '%aI',
                        message: '%s',
                        body: '%b',
                        refs: '%D'
                    }
                };
                if (this.excludeMerges) {
                    logOpts['--no-merges'] = null;
                }

                let log;
                try {
                    log = await git.log(logOpts);
                } catch (e) {
                    if ((e.message || '').includes('does not have any commits')) {
                        break;
                    }
                    throw e;
                }

                const commits = log.all || [];
                if (!commits.length) break;

                let batchNew = 0;
                let batchSkipped = 0;
                for (const entry of commits) {
                    const r = await this._upsertCommit(repositoryId, entry, repoPath);
                    if (r.inserted) {
                        batchNew += 1;
                        if (r.id) {
                            await this.indexCommitFiles(r.id, repoPath, entry.hash);
                        }
                    } else {
                        batchSkipped += 1;
                    }
                }
                totalNew += batchNew;
                totalSkipped += batchSkipped;

                const newestInBatch = commits[0].date;
                const oldestInBatch = commits[commits.length - 1].date;
                await this._updateCoverage(repositoryId, sinceIso, newestInBatch, oldestInBatch);

                IndexProgress.recordBatch({
                    indexed: batchNew,
                    skipped: batchSkipped,
                    oldestDate: oldestInBatch
                });

                if (commits.length < BATCH_SIZE) break;

                until = moment(oldestInBatch).subtract(1, 'second');
                if (!until.isAfter(since)) break;
            }

            await this._backfillCommitFiles(repositoryId, repoPath, sinceIso, untilIso);

            return totalNew;
        } catch (err) {
            console.warn(`Index failed for repo ${repositoryId} (${repoPath}):`, err.message);
            return 0;
        }
    }

    async _resolveBranchForCommit(repoPath, entry) {
        if (entry.refs && this.gitService && typeof this.gitService.extractBranchFromRefs === 'function') {
            const fromRefs = this.gitService.extractBranchFromRefs(entry.refs);
            if (fromRefs) return fromRefs;
        }
        try {
            const git = await this._getGit(repoPath);
            const nameRevResult = await git.raw(['name-rev', '--name-only', '--refs=refs/heads/*', entry.hash]);
            if (nameRevResult && nameRevResult.trim() !== 'undefined') {
                return nameRevResult.trim().replace(/[~^]\d*.*$/, '');
            }
        } catch (_) {
            // ignore name-rev errors
        }
        return null;
    }

    async _upsertCommit(repositoryId, entry, repoPath) {
        const contributorId = await this.contributors.ensureAliasFromCommit(
            entry.author,
            entry.authorEmail
        );

        let branch = null;
        if (this.indexCommitBranch && repoPath) {
            branch = await this._resolveBranchForCommit(repoPath, entry);
        }

        const existing = await this.db.get(
            'SELECT id FROM commits WHERE repository_id = ? AND hash = ?',
            [repositoryId, entry.hash]
        );

        if (existing) {
            await this.db.run(
                `UPDATE commits SET author_name = ?, author_email = ?, contributor_id = COALESCE(?, contributor_id),
                    message = ?, committed_at = ?, branch = COALESCE(?, branch) WHERE id = ?`,
                [entry.author, entry.authorEmail, contributorId, entry.message, entry.date, branch, existing.id]
            );
            return { inserted: false };
        }

        const result = await this.db.run(
            `INSERT INTO commits (repository_id, hash, author_name, author_email, contributor_id, committed_at, message, branch, is_merge)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [repositoryId, entry.hash, entry.author, entry.authorEmail, contributorId, entry.date, entry.message, branch]
        );
        return { inserted: true, id: result.id };
    }

    async _backfillCommitFiles(repositoryId, repoPath, sinceIso, untilIso) {
        const BATCH = 40;
        for (;;) {
            const rows = await this.db.all(`
                SELECT c.id, c.hash
                FROM commits c
                WHERE c.repository_id = ?
                  AND c.committed_at >= ?
                  AND c.committed_at <= ?
                  AND c.files_indexed_at IS NULL
                ORDER BY c.committed_at DESC
                LIMIT ?
            `, [repositoryId, sinceIso, untilIso || moment().toISOString(), BATCH]);
            if (!rows.length) break;
            for (const row of rows) {
                await this.indexCommitFiles(row.id, repoPath, row.hash);
            }
            if (rows.length < BATCH) break;
        }
    }

    async indexCommitFiles(commitId, repoPath, hash) {
        const existing = await this.db.get(
            'SELECT files_indexed_at FROM commits WHERE id = ?',
            [commitId]
        );
        if (existing && existing.files_indexed_at) return;

        try {
            const git = await this._getGit(repoPath);
            const stat = await git.raw(['show', '--numstat', '--format=', hash]);
            const lines = (stat || '').split('\n').filter(Boolean);

            const fileRows = [];
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length < 3) continue;
                const additions = parseInt(parts[0], 10) || 0;
                const deletions = parseInt(parts[1], 10) || 0;
                const filename = parts[2];
                if (filename === '-') continue;
                fileRows.push([commitId, filename, additions, deletions]);
            }

            // Insert in chunks of 200 rows to stay within SQLite's 999-variable limit
            const CHUNK = 200;
            for (let i = 0; i < fileRows.length; i += CHUNK) {
                const chunk = fileRows.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
                await this.db.run(
                    `INSERT INTO commit_files (commit_id, filename, additions, deletions) VALUES ${placeholders}`,
                    chunk.flat()
                );
            }

            await this.db.run(
                'UPDATE commits SET files_indexed_at = CURRENT_TIMESTAMP WHERE id = ?',
                [commitId]
            );
        } catch (e) {
            console.warn(`Failed to index files for commit ${hash}:`, e.message);
        }
    }

    async _updateCoverage(repositoryId, sinceIso, newestIso, oldestIso) {
        const agg = await this.db.get(`
            SELECT MIN(committed_at) AS oldest, MAX(committed_at) AS newest
            FROM commits WHERE repository_id = ?
        `, [repositoryId]);

        const oldest = oldestIso || agg?.oldest || sinceIso;
        const newest = newestIso || agg?.newest;

        const existing = await this.db.get('SELECT * FROM index_coverage WHERE repository_id = ?', [repositoryId]);
        if (existing) {
            const mergedOldest = existing.oldest_indexed_at && oldest
                ? (moment(existing.oldest_indexed_at).isBefore(moment(oldest))
                    ? existing.oldest_indexed_at
                    : oldest)
                : oldest || existing.oldest_indexed_at;
            const mergedNewest = existing.newest_indexed_at && newest
                ? (moment(existing.newest_indexed_at).isAfter(moment(newest))
                    ? existing.newest_indexed_at
                    : newest)
                : newest || existing.newest_indexed_at;

            await this.db.run(`
                UPDATE index_coverage SET
                    oldest_indexed_at = ?,
                    newest_indexed_at = ?,
                    last_indexed_at = CURRENT_TIMESTAMP,
                    last_accessed_at = CURRENT_TIMESTAMP
                WHERE repository_id = ?
            `, [mergedOldest, mergedNewest, repositoryId]);
        } else {
            await this.db.run(`
                INSERT INTO index_coverage (repository_id, oldest_indexed_at, newest_indexed_at, last_indexed_at, last_accessed_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [repositoryId, oldest, newest]);
        }
    }

    async touchAccess(repositoryId) {
        await this.db.run(
            'UPDATE index_coverage SET last_accessed_at = CURRENT_TIMESTAMP WHERE repository_id = ?',
            [repositoryId]
        ).catch(() => {});
    }

    async touchAccessForRepos(repositoryIds) {
        if (!repositoryIds.length) return;
        const placeholders = repositoryIds.map(() => '?').join(',');
        await this.db.run(
            `UPDATE index_coverage SET last_accessed_at = CURRENT_TIMESTAMP WHERE repository_id IN (${placeholders})`,
            repositoryIds
        ).catch(() => {});
    }

    /**
     * Remove indexed commits older than the configured index window.
     * Commits within the window are kept regardless of last_accessed_at.
     */
    async runEviction() {
        const months = await this.settings.getIndexWindowMonths();
        const windowCutoff = moment().subtract(months, 'months').toISOString();

        const affected = await this.db.all(
            'SELECT DISTINCT repository_id FROM commits WHERE committed_at < ?',
            [windowCutoff]
        );

        const result = await this.db.run(
            'DELETE FROM commits WHERE committed_at < ?',
            [windowCutoff]
        );
        const deletedCommits = result.changes || 0;

        for (const row of affected) {
            await this._recomputeCoverageAfterEviction(row.repository_id);
        }

        await this.db.run(
            'UPDATE scheduler_status SET last_eviction_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).catch(() => {});

        return {
            deletedCommits,
            windowCutoff,
            reposUpdated: affected.length
        };
    }

    async _recomputeCoverageAfterEviction(repositoryId) {
        const agg = await this.db.get(`
            SELECT MIN(committed_at) AS oldest, MAX(committed_at) AS newest, COUNT(*) AS c
            FROM commits WHERE repository_id = ?
        `, [repositoryId]);

        if (!agg || !agg.c) {
            await this.db.run('DELETE FROM index_coverage WHERE repository_id = ?', [repositoryId]);
            return;
        }

        const existing = await this.db.get(
            'SELECT repository_id FROM index_coverage WHERE repository_id = ?',
            [repositoryId]
        );
        if (existing) {
            await this.db.run(`
                UPDATE index_coverage SET
                    oldest_indexed_at = ?,
                    newest_indexed_at = ?,
                    last_indexed_at = CURRENT_TIMESTAMP
                WHERE repository_id = ?
            `, [agg.oldest, agg.newest, repositoryId]);
        } else {
            await this.db.run(`
                INSERT INTO index_coverage (repository_id, oldest_indexed_at, newest_indexed_at, last_indexed_at, last_accessed_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [repositoryId, agg.oldest, agg.newest]);
        }
    }
}

module.exports = CommitIndexer;
