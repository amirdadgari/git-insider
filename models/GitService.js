const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const moment = require('moment');
const Database = require('../config/database');

class GitService {
    constructor() {
        this.db = new Database();
        this.repositories = new Map();
        // Cache of simple-git instances by repo path (workspace-scanned repos)
        this.gitByPath = new Map();
        // In-memory cache for workspace repository discovery
        this.workspaceRepoCache = new Map(); // key -> { expiresAt:number, repos:array }
        this.workspaceRepoCacheTTL = Math.max(30, parseInt(process.env.WORKSPACE_REPO_CACHE_TTL_SECONDS || '300', 10));
        // Concurrency for parallel git operations
        this.gitConcurrency = Math.max(1, parseInt(process.env.GIT_CONCURRENCY || '8', 10));
        // In-memory month cache for commits across workspaces (named repos only)
        // Map<YYYY-MM, { commits: array, expiresAt: number, updatedAt: number, approxBytes: number }>
        this.commitMonthCache = new Map();
        this.commitMonthCacheTTL = Math.max(60, parseInt(process.env.COMMIT_MONTH_CACHE_TTL_SECONDS || '900', 10)); // default 15 minutes
    }

    // Internal helpers reused across methods
    // Concurrency-limited mapper
    async _mapConcurrent(items, mapper, limit) {
        const concurrency = Math.max(1, parseInt(limit || this.gitConcurrency, 10));
        let index = 0;
        const results = [];
        const workers = Array.from({ length: Math.min(concurrency, items.length || 0) }, async () => {
            while (true) {
                const i = index++;
                if (i >= items.length) return;
                results[i] = await mapper(items[i], i);
            }
        });
        await Promise.all(workers);
        return results;
    }

    _normalizeScanOptions(options = {}) {
        const { maxDepth = 4, exclude = ['node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next'], followSymlinks = false } = options;
        const normExclude = Array.isArray(exclude) ? [...exclude].sort((a,b)=>String(a).localeCompare(String(b))) : [];
        return { maxDepth, exclude: normExclude, followSymlinks: !!followSymlinks };
    }

    _workspaceCacheKey(rootPath, options = {}) {
        const norm = this._normalizeScanOptions(options);
        return `${path.resolve(rootPath)}::${JSON.stringify(norm)}`;
    }

    async _getWorkspaceReposCached(rootPath, options = {}) {
        const key = this._workspaceCacheKey(rootPath, options);
        const now = Date.now();
        const cached = this.workspaceRepoCache.get(key);
        if (cached && cached.expiresAt > now) {
            // Enrich cached entries with repositoryId if missing
            try {
                const enriched = await Promise.all((cached.repos || []).map(async (r) => {
                    if (!r || r.repositoryId !== undefined && r.repositoryId !== null) return r;
                    try {
                        const row = await this.db.get('SELECT id FROM git_repositories WHERE path = ?', [r.path]);
                        if (row && row.id) {
                            return { ...r, repositoryId: row.id, alreadyAdded: true };
                        }
                    } catch {}
                    return r;
                }));
                cached.repos = enriched;
                return enriched;
            } catch {
                return cached.repos;
            }
        }
        const repos = await this.scanForRepositories(rootPath, options);
        this.workspaceRepoCache.set(key, { expiresAt: now + this.workspaceRepoCacheTTL * 1000, repos });
        return repos;
    }

    // ----- Commit Month Cache Helpers -----
    _estimateBytes(obj) {
        try {
            return Buffer.byteLength(JSON.stringify(obj), 'utf8');
        } catch {
            return 0;
        }
    }

    _logCommitCacheUsage() {
        let total = 0;
        for (const v of this.commitMonthCache.values()) total += v.approxBytes || 0;
        const mb = (total / (1024 * 1024)).toFixed(2);
        if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
            console.log(`[cache] Commit month cache: ${this.commitMonthCache.size} month(s), ~${mb} MB`);
        }
    }

    _listMonthsBetween(startMoment, endMoment) {
        const months = [];
        const end = endMoment ? endMoment.clone().endOf('month') : moment();
        let cur = startMoment ? startMoment.clone().startOf('month') : end.clone().startOf('month');
        while (cur.isSameOrBefore(end)) {
            months.push({ key: cur.format('YYYY-MM'), start: cur.clone().startOf('month'), end: cur.clone().endOf('month') });
            cur = cur.add(1, 'month');
        }
        return months;
    }

    _isCacheExpired(entry) {
        const now = Date.now();
        return !entry || (entry.expiresAt || 0) < now;
    }

    _selectNamedReposOnly(repos) {
        // Only exclude repos that have a GitLab config but no name; others are treated as named by folder
        return repos.filter(r => !(r.hasGitlabConfig && !r.displayName));
    }

    async _buildMonthCommits(monthKey) {
        if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
            console.log(`[cache] Building month cache for ${monthKey}...`);
        }
        const startTime = Date.now();
        
        const excludeMerges = String(process.env.GIT_EXCLUDE_MERGES || 'true').toLowerCase() === 'true';
        const [y, m] = monthKey.split('-').map(n => parseInt(n, 10));
        const monthStart = moment({ year: y, month: m - 1, day: 1 }).startOf('month');
        const monthEnd = monthStart.clone().endOf('month');

        const sinceStr = monthStart.format('YYYY-MM-DD');
        const untilStr = monthEnd.format('YYYY-MM-DD');

        const commits = [];
        try {
            const workspaces = await this.getWorkspaces();
            if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                console.log(`[cache] Found ${workspaces.length} workspaces to scan`);
            }
            
            for (const ws of workspaces) {
                try {
                    const repos = await this._getWorkspaceReposCached(ws.root_path, {});
                    const reposToUse = this._selectNamedReposOnly(repos);
                    if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                        console.log(`[cache] Workspace ${ws.name || ws.root_path}: ${reposToUse.length} named repos`);
                    }
                    if (!reposToUse.length) continue;

                    const tasks = reposToUse.map(repoInfo => async () => {
                        try {
                            const repoStartTime = Date.now();
                            if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                                console.log(`[cache] Processing repo: ${repoInfo.displayName || repoInfo.name}`);
                            }
                            
                            const git = await this._getGitForPath(repoInfo.path);
                            const format = { hash: '%H', author: '%an', authorEmail: '%ae', date: '%at', message: '%s', refs: '%D' };

                            const simpleGitOptions = {
                                format: format,
                                '--since': sinceStr,
                                '--until': untilStr,
                            }

                            if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                                console.log(`[cache] Git log options for ${repoInfo.displayName || repoInfo.name}:`, simpleGitOptions);
                            }

                            const log = await git.log(simpleGitOptions);
                            if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                                console.log(`[cache] Found ${log.all.length} commits in ${repoInfo.displayName || repoInfo.name}`);
                            }
                            
                            let branchDetectionTime = 0;
                            const arr = [];
                            for (const c of log.all) {
                                let ts = Number(c.date);
                                if (!Number.isFinite(ts)) {
                                    const parsed = Date.parse(c.date);
                                    ts = Number.isFinite(parsed) ? parsed : NaN;
                                } else {
                                    ts = ts * 1000;
                                }
                                const d = new Date(ts);
                                if (isNaN(d.getTime())) continue;
                                // Extract branch information from refs
                                const branchStartTime = Date.now();
                                let branchInfo = null;
                                if (c.refs) {
                                    branchInfo = this.extractBranchFromRefs(c.refs);
                                }
                                
                                // Fallback: use git name-rev if no branch from refs
                                if (!branchInfo) {
                                    try {
                                        const nameRevResult = await git.raw(['name-rev', '--name-only', '--refs=refs/heads/*', c.hash]);
                                        if (nameRevResult && nameRevResult.trim() !== 'undefined') {
                                            branchInfo = nameRevResult.trim();
                                        }
                                    } catch (nameRevErr) {
                                        // Ignore name-rev errors
                                    }
                                }
                                branchDetectionTime += (Date.now() - branchStartTime);

                                arr.push({
                                    repository: repoInfo.displayName || repoInfo.name,
                                    repositoryId: repoInfo.repositoryId ?? null,
                                    hash: c.hash,
                                    author: c.author || c.author_name,
                                    authorEmail: c.authorEmail || c.author_email,
                                    date: d.toISOString(),
                                    message: c.message,
                                    branch: branchInfo
                                });
                            }
                            
                            const repoTime = Date.now() - repoStartTime;
                            if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                                console.log(`[cache] Repo ${repoInfo.displayName || repoInfo.name}: ${arr.length} commits processed in ${repoTime}ms (branch detection: ${branchDetectionTime}ms)`);
                            }
                            return arr;
                        } catch (e) {
                            console.error(`Error building month cache from ${repoInfo.path}:`, e.message);
                            return [];
                        }
                    });

                    const grouped = await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
                    for (const g of grouped) commits.push(...g);
                } catch (e) {
                    console.error(`Error scanning workspace for month cache ${ws.root_path}:`, e.message);
                }
            }
        } catch (e) {
            console.error('Error building month commits:', e.message);
        }
        
        const totalTime = Date.now() - startTime;
        if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
            console.log(`[cache] Month cache for ${monthKey} completed: ${commits.length} commits in ${totalTime}ms`);
        }
        return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    async _getOrRefreshMonthCacheAsync(monthKey, isCurrent) {
        const now = Date.now();
        let entry = this.commitMonthCache.get(monthKey);
        const expired = this._isCacheExpired(entry);
        if (!entry || expired) {
            const commits = await this._buildMonthCommits(monthKey);
            entry = {
                commits,
                updatedAt: now,
                expiresAt: now + this.commitMonthCacheTTL * 1000,
                approxBytes: this._estimateBytes(commits)
            };
            this.commitMonthCache.set(monthKey, entry);
            this._logCommitCacheUsage();
            return entry.commits;
        }
        // Keep current month warm by extending TTL on access
        if (isCurrent) {
            entry.expiresAt = now + this.commitMonthCacheTTL * 1000;
        }
        return entry.commits;
    }

    async _getGitForPath(repoPath) {
        const normalized = path.resolve(repoPath);
        if (this.gitByPath.has(normalized)) return this.gitByPath.get(normalized);
        const git = simpleGit(normalized);
        await git.raw(['rev-parse', '--git-dir']);
        this.gitByPath.set(normalized, git);
        return git;
    }
    async _resolveGitConfigPath(dir) {
        const dotGitPath = path.join(dir, '.git');
        try {
            const stat = await fs.lstat(dotGitPath);
            if (stat.isDirectory()) {
                return { configPath: path.join(dotGitPath, 'config'), type: 'worktree' };
            }
            if (stat.isFile()) {
                const content = await fs.readFile(dotGitPath, 'utf8');
                const match = content.match(/gitdir:\s*(.*)/i);
                if (match && match[1]) {
                    const gitdir = match[1].trim();
                    const resolvedGitDir = path.isAbsolute(gitdir) ? gitdir : path.resolve(dir, gitdir);
                    return { configPath: path.join(resolvedGitDir, 'config'), type: 'worktree' };
                }
            }
        } catch {}
        return { configPath: path.join(dir, 'config'), type: 'bare' };
    }

    async _parseGitlabFullpath(configPath) {
        try {
            const content = await fs.readFile(configPath, 'utf8');
            let inGitlab = false;
            let fullpath = null;
            for (const rawLine of content.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (line.startsWith('[') && line.endsWith(']')) {
                    inGitlab = line.replace(/[\[\]]/g, '').trim().toLowerCase() === 'gitlab';
                    continue;
                }
                if (inGitlab) {
                    const m = line.match(/^fullpath\s*=\s*(.+)$/i);
                    if (m) {
                        fullpath = m[1].trim();
                        break;
                    }
                }
            }
            return fullpath;
        } catch {
            return null;
        }
    }

    async initialize() {
        await this.db.connect();
        await this.loadRepositories();
    }

    async loadRepositories() {
        try {
            const repos = await this.db.all('SELECT * FROM git_repositories WHERE is_active = 1');
            
            for (const repo of repos) {
                try {
                    await fs.access(repo.path);
                    const git = simpleGit(repo.path);
                    await git.raw(['rev-parse', '--git-dir']); // Verify it's a git repository (bare or non-bare)
                    // Try to enrich missing metadata from git config
                    if (!repo.display_name || !repo.scm_fullpath) {
                        try {
                            const configInfo = await this._resolveGitConfigPath(repo.path);
                            const fullpath = await this._parseGitlabFullpath(configInfo.configPath);
                            const displayName = fullpath ? fullpath.split('/').pop() : null;
                            if (displayName || fullpath) {
                                await this.db.run(
                                    'UPDATE git_repositories SET display_name = COALESCE(?, display_name), scm = COALESCE(?, scm), scm_fullpath = COALESCE(?, scm_fullpath), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                                    [displayName, fullpath ? 'gitlab' : null, fullpath, repo.id]
                                );
                                repo.display_name = displayName || repo.display_name;
                                repo.scm = fullpath ? 'gitlab' : repo.scm;
                                repo.scm_fullpath = fullpath || repo.scm_fullpath;
                            }
                        } catch {}
                    }
                    this.repositories.set(repo.id, { ...repo, git });
                    if (String(process.env.DEV_MODE || 'false').toLowerCase() === 'true') {
                        console.log(`Loaded repository: ${repo.name}`);
                    }
                } catch (error) {
                    console.warn(`Warning: Repository ${repo.name} at ${repo.path} is not accessible`);
                }
            }
        } catch (error) {
            console.error('Error loading repositories:', error);
        }
    }

    // Get commit details by repository path (for workspace-scanned repos)
    async getCommitDetailsByPath(repoPath, commitHash) {
        if (!repoPath) throw new Error('Repository path is required');
        try {
            const git = simpleGit(repoPath);
            await git.raw(['rev-parse', '--git-dir']); // works for bare & non-bare

            const show = await git.show([commitHash, '--name-status']);
            const commit = await git.show([commitHash, '--format=fuller']);

            // Try to derive display name from git config
            let repoDisplay = null;
            try {
                const cfg = await this._resolveGitConfigPath(repoPath);
                const fullpath = await this._parseGitlabFullpath(cfg.configPath);
                if (fullpath) repoDisplay = fullpath.split('/').pop();
            } catch {}

            return {
                repository: repoDisplay || path.basename(repoPath),
                hash: commitHash,
                details: commit,
                changedFiles: show
            };
        } catch (error) {
            throw new Error(`Error getting commit details by path: ${error.message}`);
        }
    }

    // Workspaces
    async getWorkspaces() {
        const workspaces = await this.db.all('SELECT * FROM workspaces WHERE is_active = 1 ORDER BY created_at DESC');
        return workspaces;
    }

    async scanWorkspace(rootPath, options = {}) {
        if (!rootPath || typeof rootPath !== 'string') {
            throw new Error('A valid root path is required');
        }

        const normalizedRoot = path.resolve(rootPath);
        // Reuse existing scanning logic
        const repositories = await this.scanForRepositories(normalizedRoot, options);
        const repoCount = repositories.length;

        // Upsert workspace row
        const name = path.basename(normalizedRoot);
        const existing = await this.db.get('SELECT * FROM workspaces WHERE root_path = ?', [normalizedRoot]);
        if (existing) {
            await this.db.run(
                'UPDATE workspaces SET repo_count = ?, last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, name = COALESCE(name, ?) WHERE id = ?',
                [repoCount, name, existing.id]
            );
            const workspace = await this.db.get('SELECT * FROM workspaces WHERE id = ?', [existing.id]);
            return { root: normalizedRoot, count: repoCount, repositories, workspace };
        } else {
            const result = await this.db.run(
                'INSERT INTO workspaces (root_path, name, repo_count, last_scanned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [normalizedRoot, name, repoCount]
            );
            const workspace = await this.db.get('SELECT * FROM workspaces WHERE id = ?', [result.id]);
            return { root: normalizedRoot, count: repoCount, repositories, workspace };
        }
    }

    async deleteWorkspace(id) {
        if (!id) throw new Error('Workspace id is required');
        const result = await this.db.run('DELETE FROM workspaces WHERE id = ?', [id]);
        return { deleted: result.changes > 0 };
    }

    async addRepository(name, repoPath, url = null, description = null) {
        try {
            // Verify the path contains a git repository
            const git = simpleGit(repoPath);
            await git.raw(['rev-parse', '--git-dir']);

            // derive metadata from git config
            let displayName = null, scm = null, scm_fullpath = null;
            try {
                const cfg = await this._resolveGitConfigPath(repoPath);
                const fullpath = await this._parseGitlabFullpath(cfg.configPath);
                if (fullpath) {
                    scm = 'gitlab';
                    scm_fullpath = fullpath;
                    displayName = fullpath.split('/').pop();
                }
            } catch {}

            const result = await this.db.run(
                'INSERT INTO git_repositories (name, path, url, description, display_name, scm, scm_fullpath) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name, repoPath, url, description, displayName, scm, scm_fullpath]
            );

            const newRepo = {
                id: result.id,
                name,
                path: repoPath,
                url,
                description,
                display_name: displayName,
                scm,
                scm_fullpath,
                git: git
            };

            this.repositories.set(result.id, newRepo);
            return newRepo;
        } catch (error) {
            throw new Error(`Invalid git repository: ${error.message}`);
        }
    }

    async getRepositories() {
        const repos = await this.db.all('SELECT * FROM git_repositories WHERE is_active = 1 ORDER BY name');
        return repos;
    }

    async getCommitsByUser(userPattern, startDate, endDate, repositoryIds = null) {
        const commits = [];
        const repoFilter = repositoryIds ? new Set(repositoryIds) : null;
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;

        const entries = Array.from(this.repositories.entries()).filter(([repoId]) => !repoFilter || repoFilter.has(repoId));

        const tasks = entries.map(([repoId, repo]) => async () => {
            try {
                const format = {
                    hash: '%H',
                    author: '%an',
                    authorEmail: '%ae',
                    date: '%at',
                    message: '%s'
                };

                const simpleGitOptions = {
                    format: format,
                    '--author': userPattern,
                    '--since': startDate,
                    '--until': endDate,
                }
                const log = await repo.git.log({ format }, customArgs);
                const results = [];
                for (const commit of log.all) {
                    const ts = Number(commit.date) * 1000;
                    const cDate = new Date(ts);
                    if (startBound && cDate < startBound) continue;
                    if (endBound && cDate > endBound) continue;
                    results.push({
                        repository: repo.display_name || repo.name,
                        repositoryId: repoId,
                        hash: commit.hash,
                        author: commit.author || commit.author_name,
                        authorEmail: commit.authorEmail || commit.author_email,
                        date: new Date(ts).toISOString(),
                        message: commit.message
                    });
                }
                return results;
            } catch (error) {
                console.error(`Error getting commits from ${repo.name}:`, error.message);
                return [];
            }
        });

        const grouped = await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
        for (const arr of grouped) commits.push(...arr);
        return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    // Grep-based commit search across registered repositories (by DB)
    async searchCommits({ query, userPattern = null, startDate = null, endDate = null, repositoryIds = null, options = {} }) {
        if (!query || !String(query).trim()) return [];
        const commits = [];
        const repoFilter = repositoryIds ? new Set(repositoryIds) : null;
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;
        const excludeMerges = String(process.env.GIT_EXCLUDE_MERGES || 'true').toLowerCase() === 'true';

        const entries = Array.from(this.repositories.entries()).filter(([repoId]) => !repoFilter || repoFilter.has(repoId));

        const perRepoMax = options && options.limit
            ? Math.max(10, Math.ceil(options.limit / Math.max(1, entries.length)) + 5)
            : null;

        const tasks = entries.map(([repoId, repo]) => async () => {
            try {
                const format = {
                    hash: '%H',
                    author: '%an',
                    authorEmail: '%ae',
                    date: '%at',
                    message: '%s',
                    refs: '%D'
                };
                const customArgs = [
                    `--grep=${query}`,
                    '-i'
                ];
                if (userPattern) customArgs.push(`--author=${userPattern}`);
                if (startDate) customArgs.push(`--since=${startDate}`);
                if (endDate) customArgs.push(`--until=${endDate}`);
                if (excludeMerges) customArgs.push('--no-merges');
                if (perRepoMax) customArgs.push(`--max-count=${perRepoMax}`);
                // Handle branch parameter - if no branch specified, search all branches
                const branch = options && options.branch;
                if (branch) {
                    customArgs.push(branch);
                } else {
                    customArgs.push('--all');
                }

                const log = await repo.git.log({ format }, customArgs);
                const results = [];
                for (const commit of log.all) {
                    const ts = Number(commit.date) * 1000;
                    const cDate = new Date(ts);
                    if (startBound && cDate < startBound) continue;
                    if (endBound && cDate > endBound) continue;
                    results.push({
                        repository: repo.display_name || repo.name,
                        repositoryId: repoId,
                        hash: commit.hash,
                        author: commit.author || commit.author_name,
                        authorEmail: commit.authorEmail || commit.author_email,
                        date: new Date(ts).toISOString(),
                        message: commit.message,
                        branch: commit.refs ? this.extractBranchFromRefs(commit.refs) : null
                    });
                }
                return results;
            } catch (error) {
                console.error(`Error searching commits in ${repo.name}:`, error.message);
                return [];
            }
        });

        const grouped = await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
        for (const arr of grouped) commits.push(...arr);
        return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    // Get commits across all repositories found under saved workspaces
    async getCommitsFromWorkspaces(userPattern, startDate, endDate, includeUnnamed = false, options = {}) {
        const commits = [];
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;
        const excludeMerges = String(process.env.GIT_EXCLUDE_MERGES || 'true').toLowerCase() === 'true';
        const defaultSinceDays = parseInt(process.env.DEFAULT_SINCE_DAYS || '0', 10);
        const effectiveStart = startDate || (defaultSinceDays > 0 ? moment().subtract(defaultSinceDays, 'days').format('YYYY-MM-DD') : null);
        const noCache = !!(options && options.noCache);
        const branch = options && options.branch;

        // Always keep the current month's cache warm/updated
        try {
            const currentKey = moment().format('YYYY-MM');
            await this._getOrRefreshMonthCacheAsync(currentKey, true);
        } catch (e) {
            // best-effort warming; ignore errors
        }

        try {
            const workspaces = await this.getWorkspaces();
            for (const ws of workspaces) {
                try {
                    const repos = await this._getWorkspaceReposCached(ws.root_path, {});
                    // Only exclude repos that have a GitLab config but no name; others are treated as named by folder
                    const reposToUse = includeUnnamed ? repos : repos.filter(r => !(r.hasGitlabConfig && !r.displayName));
                    if (!reposToUse.length) continue;

                    // When using cache (default), fetch per-month cached named commits and filter locally.
                    // If noCache is true OR includeUnnamed is true, fall back to direct git calls for accuracy.
                    const perRepoMax = options && options.limit
                        ? Math.max(10, Math.ceil(options.limit / Math.max(1, reposToUse.length)) + 5)
                        : null;

                    if (!noCache && !includeUnnamed) {
                        // Determine covered months
                        const s = startBound ? moment(startBound) : (effectiveStart ? moment(effectiveStart, 'YYYY-MM-DD').startOf('day') : null);
                        const e = endBound ? moment(endBound) : moment();
                        const months = this._listMonthsBetween(s, e);
                        // Always warm current month cache as well
                        const currentKey = moment().format('YYYY-MM');
                        const keys = Array.from(new Set([...months.map(m => m.key), currentKey]));
                        const monthArrays = await Promise.all(keys.map(k => this._getOrRefreshMonthCacheAsync(k, k === currentKey)));
                        const monthCommits = monthArrays.flat();
                        // Filter by author/date and workspace repos selected
                        const repoIdsSet = new Set(reposToUse.map(r => r.repositoryId).filter(id => id !== null && id !== undefined));
                        for (const c of monthCommits) {
                            // Restrict to repos in this workspace iteration (by repositoryId)
                            if (c.repositoryId === null || c.repositoryId === undefined || !repoIdsSet.has(c.repositoryId)) continue;
                            const cDate = new Date(c.date);
                            if (startBound && cDate < startBound) continue;
                            if (endBound && cDate > endBound) continue;
                            if (userPattern) {
                                const re = new RegExp(userPattern);
                                if (!re.test(String(c.author)) && !re.test(String(c.authorEmail))) continue;
                            }
                            commits.push(c);
                        }
                        // Apply soft perRepoMax only as a global limiter after sorting below
                    } else {
                        const tasks = reposToUse.map(repoInfo => async () => {
                            try {
                                const git = await this._getGitForPath(repoInfo.path);
                                const format = {
                                    hash: '%H',
                                    author: '%an',
                                    authorEmail: '%ae',
                                    date: '%at',
                                    message: '%s',
                                    refs: '%D'
                                };

                                const simpleGitOptions = {
                                    format: format,
                                    '--author': userPattern,
                                    '--since': effectiveStart,
                                    '--until': endDate,
                                    '--no-merges': excludeMerges,
                                    '--max-count': perRepoMax,
                                    '--all': true,
                                    '--date': 'unix',
                                }

                                const log = await git.log(simpleGitOptions);
                                const results = [];
                                for (const commit of log.all) {
                                    // Robust timestamp handling: prefer unix seconds, fallback to Date.parse, otherwise skip
                                    let ts = Number(commit.date);
                                    if (!Number.isFinite(ts)) {
                                        const parsed = Date.parse(commit.date);
                                        ts = Number.isFinite(parsed) ? parsed : NaN;
                                    } else {
                                        ts = ts * 1000; // convert seconds to ms
                                    }
                                    const cDate = new Date(ts);
                                    if (isNaN(cDate.getTime())) {
                                        console.warn(`Skipping commit with invalid date in ${repoInfo.path}: ${commit.hash} (${commit.date})`);
                                        continue;
                                    }
                                    if (startBound && cDate < startBound) continue;
                                    if (endBound && cDate > endBound) continue;
                                    // Extract branch information - try multiple approaches
                                    let branchInfo = null;
                                    
                                    // Method 1: Use refs if available
                                    if (commit.refs) {
                                        branchInfo = this.extractBranchFromRefs(commit.refs);
                                    }
                                    
                                    // Method 2: Use git name-rev to find branch for this commit
                                    if (!branchInfo) {
                                        try {
                                            const nameRevResult = await git.raw(['name-rev', '--name-only', '--refs=refs/heads/*', commit.hash]);
                                            if (nameRevResult && nameRevResult.trim() !== 'undefined') {
                                                branchInfo = nameRevResult.trim();
                                            }
                                        } catch (nameRevErr) {
                                            // Ignore name-rev errors
                                        }
                                    }
                                    
                                    results.push({
                                        repository: repoInfo.displayName || repoInfo.name,
                                        repositoryId: repoInfo.repositoryId ?? null,
                                        hash: commit.hash,
                                        author: commit.author || commit.author_name,
                                        authorEmail: commit.authorEmail || commit.author_email,
                                        date: cDate.toISOString(),
                                        message: commit.message,
                                        branch: commit.refs ? this.extractBranchFromRefs(commit.refs) : null
                                    });
                                }
                                return results;
                            } catch (innerErr) {
                                console.error(`Error getting commits from ${repoInfo.path}:`, innerErr.message);
                                return [];
                            }
                        });

                        const grouped = await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
                        for (const arr of grouped) commits.push(...arr);
                    }
                } catch (scanErr) {
                    console.error(`Error scanning workspace ${ws.root_path}:`, scanErr.message);
                }
            }
        } catch (error) {
            console.error('Error getting commits from workspaces:', error.message);
        }

        // Global limit (post-sort)
        let sorted = commits.sort((a, b) => new Date(b.date) - new Date(a.date));
        if (options && options.limit && Number.isFinite(options.limit)) {
            sorted = sorted.slice(0, Math.max(1, parseInt(options.limit, 10)));
        }
        return sorted;
    }

    // Helper method to extract branch information from git refs
    extractBranchFromRefs(refs) {
        if (!refs) return null;
        const refList = refs.split(', ');
        
        // First try to find origin branches
        const originBranches = refList.filter(ref => 
            ref.startsWith('origin/') && !ref.includes('HEAD')
        ).map(ref => ref.replace('origin/', ''));
        
        if (originBranches.length > 0) {
            return originBranches[0];
        }
        
        // Then try local branches (excluding HEAD and tags)
        const localBranches = refList.filter(ref => 
            !ref.includes('/') && !ref.includes('HEAD') && !ref.includes('tag:') && ref.trim() !== ''
        );
        
        if (localBranches.length > 0) {
            return localBranches[0];
        }
        
        // Last resort: try to extract from any ref that looks like a branch
        const anyBranch = refList.find(ref => 
            ref.includes('/') && !ref.includes('HEAD') && !ref.includes('tag:') && !ref.includes('refs/remotes/')
        );
        
        if (anyBranch) {
            const parts = anyBranch.split('/');
            return parts[parts.length - 1];
        }
        
        return null;
    }

    async getCommitDetails(repositoryId, commitHash) {
        const id = parseInt(repositoryId, 10);
        if (!Number.isFinite(id)) throw new Error('Invalid repository id');

        let repo = this.repositories.get(id);
        if (!repo) {
            // Fallback: load from DB by id and init git instance
            const row = await this.db.get('SELECT * FROM git_repositories WHERE id = ?', [id]);
            if (!row) throw new Error('Repository not found');
            try {
                await fs.access(row.path);
                const git = simpleGit(row.path);
                await git.raw(['rev-parse', '--git-dir']);
                // Attach and cache
                repo = { ...row, git };
                this.repositories.set(id, repo);
            } catch (e) {
                throw new Error(`Repository not accessible: ${e.message}`);
            }
        }

        try {
            const show = await repo.git.show([commitHash, '--name-status']);
            const commit = await repo.git.show([commitHash, '--format=fuller']);
            
            return {
                repositoryId: id,
                repository: repo.display_name || repo.name,
                hash: commitHash,
                details: commit,
                changedFiles: show
            };
        } catch (error) {
            throw new Error(`Error getting commit details: ${error.message}`);
        }
    }

    async getCodeChangesByUser(userPattern, startDate, endDate, repositoryIds = null) {
        const changes = [];
        const repoFilter = repositoryIds ? new Set(repositoryIds) : null;
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;

        for (const [repoId, repo] of this.repositories) {
            if (repoFilter && !repoFilter.has(repoId)) continue;

            try {
                const options = [
                    '--numstat',
                    '--pretty=format:%H|%an|%ae|%ai|%s'
                ];

                if (userPattern) options.push(`--author=${userPattern}`);
                if (startDate) options.push(`--since=${startDate}`);
                if (endDate) options.push(`--until=${endDate}`);

                const log = await repo.git.raw(['log', ...options]);
                const lines = log.split('\n');
                
                let currentCommit = null;
                
                for (const line of lines) {
                    if (line.includes('|') && !line.match(/^\d+\s+\d+\s+/)) {
                        const [hash, author, email, date, message] = line.split('|');
                        currentCommit = {
                            repository: repo.display_name || repo.name,
                            repositoryId: repoId,
                            hash,
                            author,
                            email,
                            date,
                            message,
                            files: []
                        };
                        const cDate = new Date(date);
                        if ((startBound && cDate < startBound) || (endBound && cDate > endBound)) {
                            currentCommit = null; // skip this commit entirely
                        } else {
                            changes.push(currentCommit);
                        }
                    } else if (line.match(/^\d+\s+\d+\s+/) && currentCommit) {
                        const [additions, deletions, filename] = line.split('\t');
                        currentCommit.files.push({
                            filename,
                            additions: parseInt(additions) || 0,
                            deletions: parseInt(deletions) || 0
                        });
                    }
                }
            } catch (error) {
                console.error(`Error getting code changes from ${repo.name}:`, error.message);
            }
        }

        return changes.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    // Get diff for a single file in a commit by repository ID
    async getFileDiff(repositoryId, commitHash, filePath) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        if (!filePath) throw new Error('File path is required');
        try {
            // Show the patch affecting the specific file for this commit
            const diff = await repo.git.show([commitHash, '--', filePath]);
            return diff;
        } catch (error) {
            throw new Error(`Error getting file diff: ${error.message}`);
        }
    }

    // Get diff for a single file in a commit by repository path (workspace-scanned)
    async getFileDiffByPath(repoPath, commitHash, filePath) {
        if (!repoPath) throw new Error('Repository path is required');
        if (!filePath) throw new Error('File path is required');
        try {
            const git = simpleGit(repoPath);
            await git.raw(['rev-parse', '--git-dir']);
            const diff = await git.show([commitHash, '--', filePath]);
            return diff;
        } catch (error) {
            throw new Error(`Error getting file diff by path: ${error.message}`);
        }
    }

    // Get code changes across repositories found under saved workspaces
    async getCodeChangesFromWorkspaces(userPattern, startDate, endDate, includeUnnamed = false, options = {}) {
        const changes = [];
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;
        const excludeMerges = String(process.env.GIT_EXCLUDE_MERGES || 'true').toLowerCase() === 'true';
        const defaultSinceDays = parseInt(process.env.DEFAULT_SINCE_DAYS || '0', 10);
        const effectiveStart = startDate || (defaultSinceDays > 0 ? moment().subtract(defaultSinceDays, 'days').format('YYYY-MM-DD') : null);

        try {
            const workspaces = await this.getWorkspaces();
            for (const ws of workspaces) {
                try {
                    const repos = await this._getWorkspaceReposCached(ws.root_path, {});
                    // Only exclude repos that have a GitLab config but no name; others are treated as named by folder
                    const reposToUse = includeUnnamed ? repos : repos.filter(r => !(r.hasGitlabConfig && !r.displayName));
                    if (!reposToUse.length) continue;

                    const perRepoMax = options && options.limit
                        ? Math.max(10, Math.ceil(options.limit / Math.max(1, reposToUse.length)) + 5)
                        : null;

                    const tasks = reposToUse.map(repoInfo => async () => {
                        try {
                            const git = await this._getGitForPath(repoInfo.path);
                            const logArgs = [
                                'log',
                                '--numstat',
                                '--pretty=format:%H|%an|%ae|%at|%s'
                            ];
                            if (userPattern) logArgs.push(`--author=${userPattern}`);
                            if (effectiveStart) logArgs.push(`--since=${effectiveStart}`);
                            if (endDate) logArgs.push(`--until=${endDate}`);
                            if (excludeMerges) logArgs.push('--no-merges');
                            if (perRepoMax) logArgs.push(`--max-count=${perRepoMax}`);
                            // Ensure date output is in unix time for consistency
                            logArgs.push('--date=unix');

                            const log = await git.raw(logArgs);
                            const lines = log.split('\n');

                            let currentCommit = null;
                            for (const line of lines) {
                                if (line.includes('|') && !line.match(/^\d+\s+\d+\s+/)) {
                                    const [hash, author, email, atSeconds, message] = line.split('|');
                                    let ts = Number(atSeconds);
                                    if (!Number.isFinite(ts)) {
                                        const parsed = Date.parse(atSeconds);
                                        ts = Number.isFinite(parsed) ? parsed : NaN;
                                    } else {
                                        ts = ts * 1000;
                                    }
                                    const dateObj = new Date(ts);
                                    if (isNaN(dateObj.getTime())) {
                                        console.warn(`Skipping commit with invalid date in ${repoInfo.path}: ${hash} (${atSeconds})`);
                                        continue;
                                    }
                                    const iso = dateObj.toISOString();
                                    currentCommit = {
                                        repository: repoInfo.displayName || repoInfo.name,
                                        repositoryId: repoInfo.repositoryId ?? null,
                                        hash,
                                        author,
                                        email,
                                        date: iso,
                                        message,
                                        files: []
                                    };
                                    const cDate = dateObj;
                                    if ((startBound && cDate < startBound) || (endBound && cDate > endBound)) {
                                        currentCommit = null;
                                    } else {
                                        changes.push(currentCommit);
                                    }
                                } else if (line.match(/^\d+\s+\d+\s+/) && currentCommit) {
                                    const [additions, deletions, filename] = line.split('\t');
                                    currentCommit.files.push({
                                        filename,
                                        additions: parseInt(additions) || 0,
                                        deletions: parseInt(deletions) || 0
                                    });
                                }
                            }
                            return true;
                        } catch (innerErr) {
                            console.error(`Error getting code changes from ${repoInfo.path}:`, innerErr.message);
                            return false;
                        }
                    });

                    await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
                } catch (scanErr) {
                    console.error(`Error scanning workspace ${ws.root_path}:`, scanErr.message);
                }
            }
        } catch (error) {
            console.error('Error getting code changes from workspaces:', error.message);
        }

        return changes.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    async getProjectChanges(repositoryId, startDate, endDate) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const options = [
                '--numstat',
                '--pretty=format:%H|%an|%ae|%ai|%s'
            ];

            if (startDate) options.push(`--since=${startDate}`);
            if (endDate) options.push(`--until=${endDate}`);

            const log = await repo.git.raw(['log', ...options]);
            const changes = this.parseLogOutput(log, repo.display_name || repo.name, repositoryId);
            
            return changes.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (error) {
            throw new Error(`Error getting project changes: ${error.message}`);
        }
    }

    parseLogOutput(logOutput, repoName, repoId) {
        const lines = logOutput.split('\n');
        const changes = [];
        let currentCommit = null;

        for (const line of lines) {
            if (line.includes('|') && !line.match(/^\d+\s+\d+\s+/)) {
                const [hash, author, email, date, message] = line.split('|');
                currentCommit = {
                    repository: repoName,
                    repositoryId: repoId,
                    hash,
                    author,
                    email,
                    date,
                    message,
                    files: []
                };
                changes.push(currentCommit);
            } else if (line.match(/^\d+\s+\d+\s+/) && currentCommit) {
                const [additions, deletions, filename] = line.split('\t');
                currentCommit.files.push({
                    filename,
                    additions: parseInt(additions) || 0,
                    deletions: parseInt(deletions) || 0
                });
            }
        }

        return changes;
    }

    async getAllGitUsers() {
        const users = new Set();

        const collectFromLog = (log) => {
            for (const commit of log.all) {
                const name = commit.author || commit.author_name;
                const email = commit.authorEmail || commit.author_email || commit.email;
                if (!name && !email) continue;
                users.add(JSON.stringify({ name, email }));
            }
        };

        // Prefer DB-registered repositories; fall back to Workspaces if none loaded
        const repoEntries = Array.from(this.repositories.entries());
        if (repoEntries.length > 0) {
            const tasks = repoEntries.map(([repoId, repo]) => async () => {
                try {
                    const log = await repo.git.log({
                        format: { author: '%an', authorEmail: '%ae' }
                    });
                    collectFromLog(log);
                } catch (error) {
                    console.error(`Error getting users from ${repo.name}:`, error.message);
                }
            });
            await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
        } else {
            try {
                const workspaces = await this.getWorkspaces();
                for (const ws of workspaces) {
                    try {
                        const repos = await this._getWorkspaceReposCached(ws.root_path, {});
                        const tasks = repos.map(repoInfo => async () => {
                            try {
                                const git = await this._getGitForPath(repoInfo.path);
                                const log = await git.log({
                                    format: { author: '%an', authorEmail: '%ae' }
                                });
                                collectFromLog(log);
                            } catch (innerErr) {
                                console.error(`Error getting users from ${repoInfo.path}:`, innerErr.message);
                            }
                        });
                        await this._mapConcurrent(tasks, t => t(), this.gitConcurrency);
                    } catch (scanErr) {
                        console.error(`Error scanning workspace ${ws.root_path} for users:`, scanErr.message);
                    }
                }
            } catch (err) {
                console.error('Error getting users from workspaces:', err.message);
            }
        }

        return Array.from(users).map(s => JSON.parse(s));
    }

    async getBranches(repositoryId) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const branches = await repo.git.branch(['-a']);
            return branches;
        } catch (error) {
            throw new Error(`Error getting branches: ${error.message}`);
        }
    }

    async getRepositoryStats(repositoryId) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const log = await repo.git.log();
            const contributors = new Set();
            
            for (const commit of log.all) {
                contributors.add(commit.author_email);
            }

            const branches = await repo.git.branch(['-a']);
            
            return {
                repository: repo.display_name || repo.name,
                totalCommits: log.total,
                contributors: contributors.size,
                branches: branches.all.length,
                lastCommit: log.latest ? {
                    hash: log.latest.hash,
                    author: log.latest.author_name,
                    date: log.latest.date,
                    message: log.latest.message
                } : null
            };
        } catch (error) {
            throw new Error(`Error getting repository stats: ${error.message}`);
        }
    }

    // Recursively scan a folder for git repositories (supports working trees and bare repos)
    async scanForRepositories(rootPath, options = {}) {
        const { maxDepth = 4, exclude = ['node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next'], followSymlinks = false } = options;

        if (!rootPath || typeof rootPath !== 'string') {
            throw new Error('A valid root path is required');
        }

        // Normalize and ensure absolute path
        const normalizedRoot = path.resolve(rootPath);

        // Load existing repository paths once for quick lookup (also map to id for updates)
        const existing = await this.db.all('SELECT id, path FROM git_repositories');
        const existingPaths = new Set(existing.map(r => path.normalize(r.path)));
        const pathToId = new Map(existing.map(r => [path.normalize(r.path), r.id]));

        const results = [];

        const isExcluded = (name) => exclude.some(ex => ex.toLowerCase() === name.toLowerCase());

        const hasGitRepo = async (dir) => {
            // 1) Working tree repo with a .git directory or file
            try {
                await fs.access(path.join(dir, '.git'));
                return true;
            } catch {}

            // 2) Bare repo heuristic: presence of HEAD, objects, and config
            try {
                await fs.access(path.join(dir, 'HEAD'));
                await fs.access(path.join(dir, 'objects'));
                await fs.access(path.join(dir, 'config'));
                return true;
            } catch {}

            // 3) As a cheap extra heuristic, directories ending with ".git" are likely bare repos
            if (dir.toLowerCase().endsWith('.git')) {
                try {
                    await fs.access(path.join(dir, 'HEAD'));
                    return true;
                } catch {}
            }

            return false;
        };

        const resolveGitConfigPath = async (dir) => {
            // returns { configPath, type }
            const dotGitPath = path.join(dir, '.git');
            try {
                const stat = await fs.lstat(dotGitPath);
                if (stat.isDirectory()) {
                    // standard worktree .git/config
                    return { configPath: path.join(dotGitPath, 'config'), type: 'worktree' };
                }
                if (stat.isFile()) {
                    // .git is a file pointing to actual gitdir
                    const content = await fs.readFile(dotGitPath, 'utf8');
                    const match = content.match(/gitdir:\s*(.*)/i);
                    if (match && match[1]) {
                        const gitdir = match[1].trim();
                        const resolvedGitDir = path.isAbsolute(gitdir) ? gitdir : path.resolve(dir, gitdir);
                        return { configPath: path.join(resolvedGitDir, 'config'), type: 'worktree' };
                    }
                }
            } catch {}
            // bare repo fallback
            return { configPath: path.join(dir, 'config'), type: 'bare' };
        };

        const parseGitlabFullpath = async (configPath) => {
            try {
                const content = await fs.readFile(configPath, 'utf8');
                let inGitlab = false;
                let fullpath = null;
                let hasGitlab = false;
                for (const rawLine of content.split(/\r?\n/)) {
                    const line = rawLine.trim();
                    if (line.startsWith('[') && line.endsWith(']')) {
                        inGitlab = line.replace(/[\[\]]/g, '').trim().toLowerCase() === 'gitlab';
                        if (inGitlab) hasGitlab = true;
                        continue;
                    }
                    if (inGitlab) {
                        const m = line.match(/^fullpath\s*=\s*(.+)$/i);
                        if (m) {
                            fullpath = m[1].trim();
                            break;
                        }
                    }
                }
                return { fullpath, hasGitlab };
            } catch {
                return { fullpath: null, hasGitlab: false };
            }
        };

        const walk = async (dir, depth) => {
            if (depth < 0) return;
            try {
                // If this directory itself is a git repo, record and do not descend further
                if (await hasGitRepo(dir)) {
                    // Derive metadata from git config (GitLab info)
                    const { configPath } = await resolveGitConfigPath(dir);
                    const gitlabInfo = await parseGitlabFullpath(configPath);
                    const displayName = gitlabInfo.fullpath ? gitlabInfo.fullpath.split('/').pop() : null;
                    const normalized = path.normalize(dir);
                    const alreadyAdded = existingPaths.has(normalized);
                    let repositoryId = alreadyAdded ? pathToId.get(normalized) : null;

                    // If already in DB, update metadata
                    if (alreadyAdded && (displayName || gitlabInfo.fullpath)) {
                        try {
                            const repoId = pathToId.get(normalized);
                            await this.db.run(
                                'UPDATE git_repositories SET display_name = COALESCE(?, display_name), scm = COALESCE(?, scm), scm_fullpath = COALESCE(?, scm_fullpath), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                                [displayName, gitlabInfo.fullpath ? 'gitlab' : null, gitlabInfo.fullpath, repoId]
                            );
                        } catch (e) {
                            console.warn(`Failed to update metadata for ${dir}: ${e.message}`);
                        }
                    }

                    // If not in DB yet, insert it now and capture its ID
                    if (!alreadyAdded) {
                        try {
                            const name = displayName || path.basename(normalized);
                            const result = await this.db.run(
                                'INSERT INTO git_repositories (name, path, display_name, scm, scm_fullpath) VALUES (?, ?, ?, ?, ?)',
                                [name, normalized, displayName, gitlabInfo.fullpath ? 'gitlab' : null, gitlabInfo.fullpath || null]
                            );
                            repositoryId = result.id;
                            existingPaths.add(normalized);
                            pathToId.set(normalized, repositoryId);
                        } catch (e) {
                            // If insert failed due to UNIQUE constraint, fetch existing id
                            const msg = (e && e.message || '').toLowerCase();
                            if (msg.includes('unique') || msg.includes('constraint')) {
                                try {
                                    const row = await this.db.get('SELECT id FROM git_repositories WHERE path = ?', [normalized]);
                                    if (row && row.id) {
                                        repositoryId = row.id;
                                        existingPaths.add(normalized);
                                        pathToId.set(normalized, repositoryId);
                                    }
                                } catch (readErr) {
                                    console.warn(`Failed to resolve existing repo id for ${dir}: ${readErr.message}`);
                                }
                            } else {
                                console.warn(`Failed to insert repository ${dir}: ${e.message}`);
                            }
                        }
                    }

                    results.push({
                        name: displayName || path.basename(dir),
                        displayName: displayName || null,
                        path: dir,
                        repositoryId: repositoryId || null,
                        alreadyAdded,
                        scm: gitlabInfo.fullpath ? 'gitlab' : null,
                        scm_fullpath: gitlabInfo.fullpath || null,
                        hasGitlabConfig: !!gitlabInfo.hasGitlab
                    });
                    return; // don't scan nested repos inside
                }

                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    if (isExcluded(entry.name)) continue;

                    const child = path.join(dir, entry.name);
                    try {
                        const stat = followSymlinks ? await fs.stat(child) : await fs.lstat(child);
                        if (!stat.isDirectory()) continue;
                        // Avoid recursing into symlinked dirs unless allowed
                        if (!followSymlinks && stat.isSymbolicLink && stat.isSymbolicLink()) continue;
                    } catch {
                        continue; // skip unreadable entries
                    }

                    await walk(child, depth - 1);
                }
            } catch (err) {
                // Ignore directories we cannot read
                return;
            }
        };

        await walk(normalizedRoot, maxDepth);

        // Sort for stable output
        results.sort((a, b) => a.name.localeCompare(b.name));
        return results;
    }

    // Aggregate repositories found under saved workspaces
    async getRepositoriesFromWorkspaces(workspaceIds = null, options = {}) {
        const results = [];
        try {
            let workspaces = await this.getWorkspaces();
            if (Array.isArray(workspaceIds) && workspaceIds.length > 0) {
                const idSet = new Set(workspaceIds.map(id => parseInt(id, 10)));
                workspaces = workspaces.filter(ws => idSet.has(ws.id));
            }

            for (const ws of workspaces) {
                try {
                    const repos = await this.scanForRepositories(ws.root_path, options);
                    for (const r of repos) {
                        results.push({
                            ...r,
                            workspaceId: ws.id,
                            workspaceName: ws.name || (ws.root_path.split(/\\|\//).pop()),
                            workspaceRoot: ws.root_path
                        });
                    }
                } catch (err) {
                    console.error(`Error scanning workspace ${ws.root_path}:`, err.message);
                }
            }
        } catch (error) {
            console.error('Error aggregating repositories from workspaces:', error.message);
        }

        // stable sort by workspace then repo name
        results.sort((a, b) => {
            const wa = String(a.workspaceName).localeCompare(String(b.workspaceName));
            if (wa !== 0) return wa;
            return String(a.name).localeCompare(String(b.name));
        });
        return results;
    }
}

module.exports = GitService;
