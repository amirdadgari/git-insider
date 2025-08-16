// Main application JavaScript
class GitInsiderApp {
    constructor() {
        this.currentUser = null;
        this.currentPage = null; // ensure first navigation isn't skipped
        this.repositories = [];
        this.workspaces = [];
        this.gitUsers = [];
        this.scanFormInitialized = false;
        this.reposFormInitialized = false;
        this.graphqlHelpInitialized = false;
        this.graphqlHelpExpanded = false; // start collapsed
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.initTheme();
        // Handle URL changes (hash-based routing)
        window.addEventListener('hashchange', this.handleRouteChange.bind(this));
        
        // Check if user is logged in
        const token = localStorage.getItem('authToken');
        if (token) {
            try {
                await this.loadUserData();
                this.hideLoginModal();
                // Route based on current URL (hash)
                this.handleRouteChange();
            } catch (error) {
                this.showLoginModal();
            }
        } else {
            this.showLoginModal();
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.currentTarget.getAttribute('data-page');
                // Update hash; route handler will navigate
                const hash = page === 'git-users' ? 'users' : page;
                if (window.location.hash !== `#${hash}`) {
                    window.location.hash = `#${hash}`;
                } else {
                    // If hash didn't change, manually trigger
                    this.handleRouteChange();
                }
            });
        });

        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => {
            this.toggleTheme();
        });

        // User menu
        document.getElementById('user-menu-button').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleUserMenu();
        });

        document.addEventListener('click', () => {
            this.closeUserMenu();
        });

        // Logout
        document.getElementById('logout-link').addEventListener('click', (e) => {
            e.preventDefault();
            this.logout();
        });
    }

    initTheme() {
        const theme = localStorage.getItem('theme') || 'light';
        this.setTheme(theme);
    }

    setTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            document.getElementById('theme-icon').textContent = '☀️';
        } else {
            document.documentElement.classList.remove('dark');
            document.getElementById('theme-icon').textContent = '🌙';
        }
        localStorage.setItem('theme', theme);
        // Re-render GraphiQL to apply theme changes when on the GraphQL page
        if (this.currentPage === 'graphql') {
            this.renderGraphQL(true);
        }
    }

    toggleTheme() {
        const isDark = document.documentElement.classList.contains('dark');
        this.setTheme(isDark ? 'light' : 'dark');
    }

    toggleUserMenu() {
        const dropdown = document.getElementById('user-dropdown');
        dropdown.classList.toggle('hidden');
    }

    closeUserMenu() {
        const dropdown = document.getElementById('user-dropdown');
        dropdown.classList.add('hidden');
    }

    showLoginModal() {
        document.getElementById('login-modal').classList.remove('hidden');
    }

    hideLoginModal() {
        document.getElementById('login-modal').classList.add('hidden');
    }

    async loadUserData() {
        try {
            const response = await this.apiCall('/api/auth/me');
            this.currentUser = response;
            document.getElementById('username-display').textContent = response.username;
            
            // Show/hide admin elements
            const adminElements = document.querySelectorAll('.admin-only');
            adminElements.forEach(el => {
                if (response.role === 'admin') {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            });
        } catch (error) {
            throw new Error('Failed to load user data');
        }
    }

    async loadRepositories() {
        try {
            const response = await this.apiCall('/api/git/repositories');
            this.repositories = response;
            
            // Update repository dropdowns
            this.updateRepositoryDropdowns();
        } catch (error) {
            console.error('Error loading repositories:', error);
        }
    }

    updateRepositoryDropdowns() {
        const dropdowns = document.querySelectorAll('select[id*="repository"]');
        dropdowns.forEach(select => {
            // Clear existing options except "All Repositories"
            select.innerHTML = '<option value="">All Repositories</option>';
            
            this.repositories.forEach(repo => {
                const option = document.createElement('option');
                option.value = repo.id;
                option.textContent = repo.name;
                select.appendChild(option);
            });
        });
    }

    async loadGitUsers() {
        try {
            const response = await this.apiCall('/api/git/users');
            this.gitUsers = response;
        } catch (error) {
            console.error('Error loading git users:', error);
        }
    }

    // Determine desired page from the URL hash (with aliases)
    getPageFromUrl() {
        const raw = window.location.hash ? window.location.hash.slice(1) : '';
        const aliases = { 'users': 'git-users', 'repositories': 'workspaces' };
        const page = aliases[raw] || raw || 'dashboard';
        return page;
    }

    // Centralized route handler
    handleRouteChange() {
        const page = this.getPageFromUrl();
        // Admin guard
        if (page === 'admin' && (!this.currentUser || this.currentUser.role !== 'admin')) {
            // Redirect to dashboard if not allowed
            this.navigateTo('dashboard', { updateHash: true });
            return;
        }
        this.navigateTo(page, { updateHash: false });
    }

    navigateTo(page, { updateHash = true } = {}) {
        // Optionally update the URL hash (use alias for nicer URL)
        if (updateHash) {
            const outHash = page === 'git-users' ? 'users' : page;
            if (window.location.hash !== `#${outHash}`) {
                window.location.hash = `#${outHash}`;
            }
        }

        // Prevent duplicate navigation work
        if (this.currentPage === page) {
            return;
        }

        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        const activeLink = document.querySelector(`[data-page="${page}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Hide all pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.add('hidden');
        });
        
        // Show current page
        const pageEl = document.getElementById(`${page}-page`);
        if (pageEl) pageEl.classList.remove('hidden');
        this.currentPage = page;

        // Load page data
        this.loadPageData(page);
    }

    async loadPageData(page) {
        this.showLoading();
        
        try {
            switch (page) {
                case 'dashboard':
                    await this.loadDashboard();
                    break;
                case 'commits':
                    await this.loadRepositories();
                    break;
                case 'code-changes':
                    await this.loadRepositories();
                    break;
                case 'repos':
                    await this.loadReposPage();
                    break;
                case 'workspaces':
                    await this.loadWorkspacesPage();
                    break;
                case 'tokens':
                    if (window.tokens && typeof window.tokens.loadTokensPage === 'function') {
                        await window.tokens.loadTokensPage();
                    } else {
                        console.warn('Tokens module not loaded; falling back to legacy renderer');
                        if (typeof this.loadTokensPage === 'function') {
                            await this.loadTokensPage();
                        }
                    }
                    break;
                case 'git-users':
                    await this.loadGitUsersPage();
                    break;
                case 'graphql':
                    await this.renderGraphQL();
                    // Initialize or update Help/Examples toggle UI
                    this.setupGraphQLHelpToggle();
                    break;
                case 'apis':
                    await this.loadApisPage();
                    break;
                case 'admin':
                    if (this.currentUser.role === 'admin') {
                        if (typeof admin !== 'undefined' && typeof admin.loadAdminPage === 'function') {
                            await admin.loadAdminPage();
                        } else {
                            console.warn('Admin module not loaded or loadAdminPage missing');
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error loading page data:', error);
            this.showError('Failed to load page data');
        }
        
        this.hideLoading();
    }

    setupGraphQLHelpToggle() {
        const btn = document.getElementById('graphql-help-toggle');
        const grid = document.getElementById('graphql-grid');
        const helpCard = document.getElementById('graphql-help-card');
        const editorCard = document.getElementById('graphql-editor-card');
        if (!btn || !grid || !helpCard || !editorCard) return;

        const applyState = () => {
            if (this.graphqlHelpExpanded) {
                // Expanded: show help, 3-col grid on large screens, editor spans 2
                helpCard.classList.remove('hidden');
                grid.classList.add('lg:grid-cols-3');
                editorCard.classList.add('lg:col-span-2');
                btn.textContent = 'Hide Help';
                btn.setAttribute('aria-expanded', 'true');
            } else {
                // Collapsed: hide help, single column everywhere
                helpCard.classList.add('hidden');
                grid.classList.remove('lg:grid-cols-3');
                editorCard.classList.remove('lg:col-span-2');
                btn.textContent = 'Show Help';
                btn.setAttribute('aria-expanded', 'false');
            }
            // Let GraphiQL and the layout recompute sizes
            setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
        };

        // Ensure initial UI reflects current state (default collapsed)
        applyState();

        if (!this.graphqlHelpInitialized) {
            // Accessibility
            btn.setAttribute('aria-controls', helpCard.id);
            btn.setAttribute('aria-expanded', String(this.graphqlHelpExpanded));
            btn.addEventListener('click', () => {
                this.graphqlHelpExpanded = !this.graphqlHelpExpanded;
                applyState();
            });
            this.graphqlHelpInitialized = true;
        }
    }

    async loadDashboard() {
        try {
            // Load repositories for stats
            await this.loadRepositories();
            
            // Create stats cards
            const statsGrid = document.getElementById('stats-grid');
            statsGrid.innerHTML = `
                <div class="stat-card">
                    <div class="text-2xl font-bold">${this.repositories.length}</div>
                    <div class="text-sm opacity-90">Repositories</div>
                </div>
                <div class="stat-card">
                    <div class="text-2xl font-bold" id="total-commits">-</div>
                    <div class="text-sm opacity-90">Total Commits</div>
                </div>
                <div class="stat-card">
                    <div class="text-2xl font-bold" id="total-contributors">-</div>
                    <div class="text-sm opacity-90">Contributors</div>
                </div>
                <div class="stat-card">
                    <div class="text-2xl font-bold" id="active-repos">-</div>
                    <div class="text-sm opacity-90">Active Repos</div>
                </div>
            `;

            // Load recent commits
            await this.loadRecentActivity();
            
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    }

    async loadRecentActivity() {
        try {
            const response = await this.apiCall('/api/git/commits?limit=10');
            const recentCommitsContainer = document.getElementById('recent-commits');
            
            if (response.commits.length === 0) {
                recentCommitsContainer.innerHTML = '<p class="text-gray-500 dark:text-dark-text-secondary">No recent commits found</p>';
                return;
            }

            recentCommitsContainer.innerHTML = response.commits.map(commit => `
                <div class="commit-card">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="text-sm font-medium text-gray-900 dark:text-dark-text">${commit.message}</div>
                            <div class="text-xs text-gray-500 dark:text-dark-text-secondary mt-1">
                                ${commit.author} • ${this.formatDate(commit.date)} • ${commit.repository}
                            </div>
                        </div>
                        <div class="badge badge-gray text-xs font-mono">${commit.hash.substring(0, 7)}</div>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading recent activity:', error);
        }
    }

    async loadWorkspaces() {
        try {
            const response = await this.apiCall('/api/git/workspaces');
            this.workspaces = response;
        } catch (error) {
            console.error('Error loading workspaces:', error);
            this.workspaces = [];
        }
    }

    async loadWorkspacesPage() {
        try {
            await this.loadWorkspaces();
            const container = document.getElementById('workspaces-list');
            const format = (d) => d ? this.formatDate(d) : '—';
            const isAdmin = this.currentUser && this.currentUser.role === 'admin';

            container.innerHTML = this.workspaces.map(ws => `
                <div class="commit-card">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="font-medium text-gray-900 dark:text-dark-text">${ws.name || (ws.root_path.split(/\\|\//).pop())}</div>
                            <div class="text-sm text-gray-500 dark:text-dark-text-secondary">${ws.root_path}</div>
                            <div class="text-sm text-gray-600 dark:text-dark-text-secondary mt-1">Repos: <span class="font-medium">${ws.repo_count || 0}</span> • Last scanned: ${format(ws.last_scanned_at)}</div>
                        </div>
                        <div class="flex items-center space-x-2">
                            ${isAdmin ? `<button class="btn btn-danger btn-sm" data-action="remove-workspace" data-id="${ws.id}">Remove</button>` : ''}
                            <button class="btn btn-secondary btn-sm" data-action="rescan" data-path="${encodeURIComponent(ws.root_path)}">Rescan</button>
                        </div>
                    </div>
                </div>
            `).join('');

            // Bind rescan buttons
            container.querySelectorAll('button[data-action="rescan"]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const rootPath = decodeURIComponent(e.currentTarget.getAttribute('data-path'));
                    try {
                        this.showLoading();
                        const resp = await this.apiCall('/api/git/workspaces/scan', {
                            method: 'POST',
                            body: JSON.stringify({ path: rootPath })
                        });
                        this.showSuccess(`Scanned: Found ${resp.count} repositories`);
                        // Update scan results and saved list
                        const statusEl = document.getElementById('scan-status');
                        if (statusEl) statusEl.textContent = `Found ${resp.count} repositories in ${resp.root}`;
                        const resultsEl = document.getElementById('scan-results');
                        if (resultsEl) resultsEl.innerHTML = '';
                        await this.loadWorkspaces();
                        await this.loadWorkspacesPage();
                    } catch (err) {
                        console.error('Rescan failed:', err);
                        this.showError(err.message || 'Rescan failed');
                    } finally {
                        this.hideLoading();
                    }
                });
            });

            // Bind remove buttons (admin only)
            if (isAdmin) {
                container.querySelectorAll('button[data-action="remove-workspace"]').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const id = e.currentTarget.getAttribute('data-id');
                        if (!id) return;
                        if (!confirm('Remove this workspace? This does not delete any repositories on disk.')) return;
                        try {
                            e.currentTarget.disabled = true;
                            await this.apiCall(`/api/admin/workspaces/${id}`, { method: 'DELETE' });
                            this.showSuccess('Workspace removed');
                            await this.loadWorkspacesPage();
                        } catch (err) {
                            console.error('Remove workspace failed:', err);
                            this.showError(err.message || 'Failed to remove workspace');
                            e.currentTarget.disabled = false;
                        }
                    });
                });
            }

            // Ensure scan form listeners are attached
            this.setupScanFormListeners();
        } catch (error) {
            console.error('Error loading workspaces page:', error);
        }
    }

    async loadReposPage() {
        try {
            // Ensure workspaces are loaded for filter options
            await this.loadWorkspaces();
            const selectEl = document.getElementById('repos-workspaces');
            if (selectEl) {
                // Populate multi-select
                selectEl.innerHTML = '';
                this.workspaces.forEach(ws => {
                    const opt = document.createElement('option');
                    opt.value = ws.id;
                    opt.textContent = ws.name || (ws.root_path.split(/\\|\//).pop());
                    selectEl.appendChild(opt);
                });
            }

            // Setup filter form listeners once
            if (!this.reposFormInitialized) {
                const form = document.getElementById('repos-filter-form');
                const resetBtn = document.getElementById('repos-reset');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const selectedIds = Array.from((document.getElementById('repos-workspaces') || {}).selectedOptions || []).map(o => o.value);
                        await this.fetchAndRenderWorkspaceRepos(selectedIds);
                    });
                }
                if (resetBtn) {
                    resetBtn.addEventListener('click', async () => {
                        const sel = document.getElementById('repos-workspaces');
                        if (sel) Array.from(sel.options).forEach(o => o.selected = false);
                        await this.fetchAndRenderWorkspaceRepos([]);
                    });
                }
                this.reposFormInitialized = true;
            }

            // Initial load: show all repos
            await this.fetchAndRenderWorkspaceRepos([]);
        } catch (error) {
            console.error('Error loading repos page:', error);
            this.showError('Failed to load repositories');
        }
    }

    async fetchAndRenderWorkspaceRepos(workspaceIds = []) {
        try {
            this.showLoading();
            const params = new URLSearchParams();
            if (Array.isArray(workspaceIds) && workspaceIds.length > 0) {
                params.set('workspaces', workspaceIds.join(','));
            }
            const endpoint = `/api/git/workspaces/repositories${params.toString() ? '?' + params.toString() : ''}`;
            const data = await this.apiCall(endpoint);

            const countEl = document.getElementById('repos-count');
            const listEl = document.getElementById('repos-results');
            if (countEl) countEl.textContent = `${data.count} repositories`;
            if (listEl) {
                if (!data.repositories || data.repositories.length === 0) {
                    listEl.innerHTML = '<p class="text-gray-500 dark:text-dark-text-secondary">No repositories found.</p>';
                } else {
                    listEl.innerHTML = data.repositories.map(r => `
                        <div class="commit-card">
                            <div class="flex items-center justify-between">
                                <div>
                                    <div class="font-medium text-gray-900 dark:text-dark-text">${r.name}</div>
                                    <div class="text-sm text-gray-500 dark:text-dark-text-secondary">${r.path}</div>
                                    <div class="text-xs text-gray-500 dark:text-dark-text-secondary mt-1">Workspace: ${r.workspaceName}</div>
                                </div>
                                <div class="flex items-center space-x-2">
                                    ${r.alreadyAdded ? `<span class="badge badge-success">Already added</span>` : ``}
                                </div>
                            </div>
                        </div>
                    `).join('');
                }
            }
        } catch (err) {
            console.error('Failed to fetch repositories from workspaces:', err);
            this.showError(err.message || 'Failed to load repositories');
        } finally {
            this.hideLoading();
        }
    }

    // Setup scan form submit handler (idempotent)
    setupScanFormListeners() {
        if (this.scanFormInitialized) return;
        const form = document.getElementById('scan-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pathInput = document.getElementById('scan-path');
            const maxDepthInput = document.getElementById('scan-max-depth');
            const followSymlinksInput = document.getElementById('scan-follow-symlinks');
            const excludeInput = document.getElementById('scan-exclude');
            const statusEl = document.getElementById('scan-status');
            const resultsEl = document.getElementById('scan-results');

            const rootPath = pathInput.value.trim();
            if (!rootPath) {
                this.showError('Please enter a folder path to scan');
                return;
            }

            const maxDepth = maxDepthInput.value !== '' ? parseInt(maxDepthInput.value, 10) : undefined;
            const followSymlinks = !!followSymlinksInput.checked;
            const exclude = excludeInput.value.trim()
                ? excludeInput.value.split(',').map(s => s.trim()).filter(Boolean)
                : undefined;

            statusEl.textContent = 'Scanning...';
            if (resultsEl) resultsEl.innerHTML = '';

            try {
                const resp = await this.apiCall('/api/git/workspaces/scan', {
                    method: 'POST',
                    body: JSON.stringify({ path: rootPath, maxDepth, exclude, followSymlinks })
                });
                statusEl.textContent = `Found ${resp.count} repositories in ${resp.root}`;
                if (resultsEl) resultsEl.innerHTML = '';
                // Refresh saved workspaces list
                await this.loadWorkspaces();
                await this.loadWorkspacesPage();
            } catch (err) {
                console.error('Scan failed:', err);
                statusEl.textContent = '';
                this.showError(err.message || 'Scan failed');
            }
        });

        this.scanFormInitialized = true;
    }

    renderScanResults(repos) {
        const resultsEl = document.getElementById('scan-results');
        if (!resultsEl) return;
        if (!Array.isArray(repos) || repos.length === 0) {
            resultsEl.innerHTML = '<p class="text-gray-600 dark:text-dark-text-secondary">No repositories found.</p>';
            return;
        }

        resultsEl.innerHTML = repos.map(r => `
            <div class="commit-card">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-medium text-gray-900 dark:text-dark-text">${r.name}</div>
                        <div class="text-sm text-gray-500 dark:text-dark-text-secondary">${r.path}</div>
                    </div>
                    <div class="flex items-center space-x-2">
                        ${r.alreadyAdded ? `<span class="badge badge-success">Already added</span>` : ``}
                    </div>
                </div>
            </div>
        `).join('');
    }

    async addRepositoryFromScan(repo, buttonEl) {
        try {
            if (buttonEl) buttonEl.disabled = true;
            const body = { name: repo.name, path: repo.path };
            await this.apiCall('/api/admin/repositories', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            this.showSuccess(`Added repository: ${repo.name}`);
            // Refresh repositories list and mark as added in UI
            await this.loadRepositories();
            this.updateRepositoryDropdowns();
            if (buttonEl) {
                const badge = buttonEl.parentElement.querySelector('.badge');
                if (badge) {
                    badge.classList.remove('badge-gray');
                    badge.classList.add('badge-success');
                    badge.textContent = 'Already added';
                }
                buttonEl.remove();
            }
            // If currently on workspaces page, refresh list rendering
            if (this.currentPage === 'workspaces') {
                await this.loadWorkspacesPage();
            }
        } catch (err) {
            console.error('Add repository failed:', err);
            this.showError(err.message || 'Failed to add repository');
            if (buttonEl) buttonEl.disabled = false;
        }
    }

    async loadGitUsersPage() {
        try {
            await this.loadGitUsers();
            const container = document.getElementById('git-users-list');
            
            container.innerHTML = this.gitUsers.map(user => `
                <div class="commit-card">
                    <div class="text-center">
                        <div class="text-lg font-medium text-gray-900 dark:text-dark-text">${user.name}</div>
                        <div class="text-sm text-gray-500 dark:text-dark-text-secondary">${user.email}</div>
                        <button class="btn btn-secondary btn-sm mt-2" onclick="app.viewUserCommits('${user.email}')">
                            View Commits
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading git users:', error);
        }
    }

    async loadTokensPage() {
        try {
            await this.loadTokens();
            const container = document.getElementById('tokens-list');
            
            container.innerHTML = this.tokens.map(token => `
                <div class="commit-card">
                    <div class="text-center">
                        <div class="text-lg font-medium text-gray-900 dark:text-dark-text">${token.name}</div>
                        <div class="text-sm text-gray-500 dark:text-dark-text-secondary">${token.value}</div>
                        <button class="btn btn-secondary btn-sm mt-2" onclick="app.viewTokenCommits('${token.value}')">
                            View Commits
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading tokens:', error);
        }
    }

    async loadTokens() {
        try {
            const response = await this.apiCall('/api/auth/tokens');
            this.tokens = response;
        } catch (error) {
            console.error('Error loading tokens:', error);
        }
    }

    // ===== APIs Page =====
    getApiCatalog() {
        // Central list of available endpoints (extend as needed)
        const isAdmin = this.currentUser && this.currentUser.role === 'admin';
        return [
            // Auth
            {
                group: 'Auth', method: 'GET', path: '/api/auth/me', desc: 'Get current authenticated user',
                params: [], requireAdmin: false
            },
            {
                group: 'Auth', method: 'GET', path: '/api/auth/tokens', desc: 'List API tokens for current user',
                params: [], requireAdmin: false
            },
            {
                group: 'Auth', method: 'POST', path: '/api/auth/tokens', desc: 'Create a new API token',
                params: [], body: { name: 'My Token', expiresAt: null }, requireAdmin: false
            },
            {
                group: 'Auth', method: 'DELETE', path: '/api/auth/tokens/:tokenId', desc: 'Revoke API token',
                params: [{ name: 'tokenId', in: 'path', required: true, example: 1 }], requireAdmin: false
            },

            // Git
            { group: 'Git', method: 'GET', path: '/api/git/repositories', desc: 'List added repositories', params: [] },
            { group: 'Git', method: 'GET', path: '/api/git/workspaces', desc: 'List saved workspaces', params: [] },
            {
                group: 'Git', method: 'GET', path: '/api/git/workspaces/repositories', desc: 'List repositories found under saved workspaces',
                params: [{ name: 'workspaces', in: 'query', required: false, example: '1,2' }]
            },
            {
                group: 'Git', method: 'POST', path: '/api/git/workspaces/scan', desc: 'Scan a folder for git repositories and persist as a workspace',
                params: [], body: { path: 'D:/Projects', maxDepth: 4, exclude: ['node_modules','.git','dist','build'], followSymlinks: false }
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/commits', desc: 'Get commits by user and date range',
                params: [
                    { name: 'user', in: 'query', required: false, example: 'user@example.com' },
                    { name: 'startDate', in: 'query', required: false, example: '2025-01-01' },
                    { name: 'endDate', in: 'query', required: false, example: '2025-12-31' },
                    { name: 'repositories', in: 'query', required: false, example: '1,2' },
                    { name: 'limit', in: 'query', required: false, example: 10 }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/commits/by-path', desc: 'Get commit details by repo path (workspace-scanned)',
                params: [
                    { name: 'repoPath', in: 'query', required: true, example: 'D:/Projects/repo' },
                    { name: 'hash', in: 'query', required: true, example: 'abcdef1' }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/commits/:repositoryId/:hash', desc: 'Get commit details by repository id',
                params: [
                    { name: 'repositoryId', in: 'path', required: true, example: 1 },
                    { name: 'hash', in: 'path', required: true, example: 'abcdef1' }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/diff/:repositoryId/:hash', desc: 'Get per-file diff (requires filePath query)',
                params: [
                    { name: 'repositoryId', in: 'path', required: true, example: 1 },
                    { name: 'hash', in: 'path', required: true, example: 'abcdef1' },
                    { name: 'filePath', in: 'query', required: true, example: 'src/index.js' }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/diff/by-path', desc: 'Get per-file diff by repository path',
                params: [
                    { name: 'repoPath', in: 'query', required: true, example: 'D:/Projects/repo' },
                    { name: 'hash', in: 'query', required: true, example: 'abcdef1' },
                    { name: 'filePath', in: 'query', required: true, example: 'src/index.js' }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/code-changes', desc: 'Get code changes by user and date range',
                params: [
                    { name: 'user', in: 'query', required: false, example: 'user@example.com' },
                    { name: 'startDate', in: 'query', required: false, example: '2025-01-01' },
                    { name: 'endDate', in: 'query', required: false, example: '2025-12-31' },
                    { name: 'repositories', in: 'query', required: false, example: '1,2' },
                    { name: 'limit', in: 'query', required: false, example: 10 }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/repositories/:id/stats', desc: 'Get repository statistics',
                params: [ { name: 'id', in: 'path', required: true, example: 1 } ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/repositories/:id/branches', desc: 'List branches for a repository',
                params: [ { name: 'id', in: 'path', required: true, example: 1 } ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/repositories/:id/changes', desc: 'Project changes within date range',
                params: [
                    { name: 'id', in: 'path', required: true, example: 1 },
                    { name: 'startDate', in: 'query', required: false, example: '2025-01-01' },
                    { name: 'endDate', in: 'query', required: false, example: '2025-12-31' },
                    { name: 'limit', in: 'query', required: false, example: 50 }
                ]
            },
            {
                group: 'Git', method: 'GET', path: '/api/git/users', desc: 'Get all git users across all repositories', params: []
            },

            // Admin
            {
                group: 'Admin', method: 'GET', path: '/api/admin/stats', desc: 'System statistics',
                params: [], requireAdmin: true
            },
            {
                group: 'Admin', method: 'GET', path: '/api/admin/users', desc: 'List users',
                params: [], requireAdmin: true
            },
            {
                group: 'Admin', method: 'POST', path: '/api/admin/repositories', desc: 'Add repository (admin)',
                params: [], requireAdmin: true,
                body: { name: 'repo-name', path: 'D:/Projects/repo', url: '', description: '' }
            },
        ].filter(item => !(item.requireAdmin && !isAdmin));
    }

    buildUrlWithParams(path, pathParams = {}, queryParams = {}) {
        let finalPath = path;
        Object.entries(pathParams).forEach(([k, v]) => {
            finalPath = finalPath.replace(`:${k}`, encodeURIComponent(v));
        });
        const qs = new URLSearchParams();
        Object.entries(queryParams).forEach(([k, v]) => {
            if (v !== undefined && v !== null && String(v) !== '') qs.append(k, v);
        });
        return qs.toString() ? `${finalPath}?${qs.toString()}` : finalPath;
    }

    async loadApisPage() {
        const listEl = document.getElementById('apis-list');
        const apis = this.getApiCatalog();
        const methodBadge = (m) => `<span class="badge badge-gray mr-2">${m}</span>`;
        const lock = (a) => a.requireAdmin ? '<span class="badge badge-gray ml-2">Admin</span>' : '';
        listEl.innerHTML = apis.map(a => `
            <div class="commit-card">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-mono text-sm text-gray-700 dark:text-dark-text">${methodBadge(a.method)} ${a.path}</div>
                        <div class="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">${a.desc || ''} ${lock(a)}</div>
                    </div>
                    <div class="flex items-center space-x-2">
                        <button class="btn btn-secondary btn-sm" data-action="try" data-path="${a.path}" data-method="${a.method}">Try</button>
                    </div>
                </div>
            </div>
        `).join('');

        // Bind Try buttons
        listEl.querySelectorAll('button[data-action="try"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.currentTarget.getAttribute('data-path');
                const method = e.currentTarget.getAttribute('data-method');
                const api = apis.find(x => x.path === path && x.method === method);
                if (api) this.showApiTryModal(api);
            });
        });
    }

    showApiTryModal(api) {
        const modal = document.createElement('div');
        modal.id = 'api-try-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto';

        const pathParams = (api.params || []).filter(p => p.in === 'path');
        const queryParams = (api.params || []).filter(p => p.in !== 'path');

        const pathInputs = pathParams.map(p => `
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">${p.name}${p.required ? ' *' : ''}</label>
                <input type="text" class="input" data-kind="path" data-name="${p.name}" placeholder="${p.example ?? ''}">
            </div>
        `).join('');

        const queryInputs = queryParams.map(p => `
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">${p.name}${p.required ? ' *' : ''}</label>
                <input type="text" class="input" data-kind="query" data-name="${p.name}" placeholder="${p.example ?? ''}">
            </div>
        `).join('');

        const bodySample = api.body ? JSON.stringify(api.body, null, 2) : '';

        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto">
                <div class="flex items-center justify-between mb-4 sticky top-0 z-10 bg-white dark:bg-dark-bg-secondary pb-2">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-dark-text">Try API</h2>
                    <button onclick="this.closest('#api-try-modal').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Method</label>
                        <select class="select" id="api-method">
                            ${['GET','POST','PUT','PATCH','DELETE'].map(m => `<option ${m===api.method?'selected':''}>${m}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Endpoint</label>
                        <input type="text" id="api-path" class="input" value="${api.path}" />
                    </div>
                </div>

                ${pathParams.length ? `<div class="mb-4"><h3 class="font-semibold mb-2 text-gray-900 dark:text-dark-text">Path Params</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${pathInputs}</div></div>` : ''}
                ${queryParams.length ? `<div class="mb-4"><h3 class="font-semibold mb-2 text-gray-900 dark:text-dark-text">Query Params</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${queryInputs}</div></div>` : ''}

                <div class="mb-4">
                    <h3 class="font-semibold mb-2 text-gray-900 dark:text-dark-text">Headers</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">Authorization (Bearer)</label>
                            <input type="text" class="input" id="api-auth" value="${localStorage.getItem('authToken') || ''}" placeholder="JWT token">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-dark-text mb-1">X-API-Key (optional)</label>
                            <input type="text" class="input" id="api-xkey" value="${localStorage.getItem('activeApiKey') || ''}" placeholder="API key">
                            <p class="text-xs text-gray-500 dark:text-dark-text-secondary mt-1">If provided, X-API-Key will be used and Authorization will be ignored.</p>
                        </div>
                    </div>
                </div>

                ${['POST','PUT','PATCH'].includes(api.method) || api.body ? `
                <div class="mb-4">
                    <h3 class="font-semibold mb-2 text-gray-900 dark:text-dark-text">Body (JSON)</h3>
                    <textarea id="api-body" class="input" rows="8" placeholder="{ }">${bodySample}</textarea>
                </div>` : ''}

                <div class="flex items-center justify-end space-x-2 mb-4">
                    <button class="btn btn-secondary" onclick="this.closest('#api-try-modal').remove()">Close</button>
                    <button class="btn btn-primary" id="api-send-btn">Send</button>
                </div>

                <div id="api-response" class="bg-gray-50 dark:bg-gray-800 rounded p-3 overflow-auto max-h-[60vh]">
                    <div id="api-response-meta" class="text-xs text-gray-500 dark:text-dark-text-secondary mb-2"></div>
                    <pre class="text-sm"><code id="api-response-body" class="language-json">Click Send to see response...</code></pre>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const sendBtn = modal.querySelector('#api-send-btn');
        sendBtn.addEventListener('click', async () => {
            try {
                sendBtn.disabled = true;
                sendBtn.textContent = 'Sending...';

                const method = modal.querySelector('#api-method').value;
                const basePath = modal.querySelector('#api-path').value.trim();
                const auth = modal.querySelector('#api-auth').value.trim();
                const xkey = modal.querySelector('#api-xkey').value.trim();
                const pathInputs = Array.from(modal.querySelectorAll('input[data-kind="path"]'));
                const queryInputs = Array.from(modal.querySelectorAll('input[data-kind="query"]'));
                const pathVals = Object.fromEntries(pathInputs.map(i => [i.getAttribute('data-name'), i.value.trim()]));
                const queryVals = Object.fromEntries(queryInputs.map(i => [i.getAttribute('data-name'), i.value.trim()]));
                const url = this.buildUrlWithParams(basePath, pathVals, queryVals);
                let bodyText = '';
                const bodyEl = modal.querySelector('#api-body');
                if (bodyEl) bodyText = bodyEl.value.trim();

                const headers = { 'Content-Type': 'application/json' };
                if (xkey) {
                    headers['X-API-Key'] = xkey;
                    try { localStorage.setItem('activeApiKey', xkey); } catch (e) {}
                } else if (auth) {
                    headers['Authorization'] = `Bearer ${auth}`;
                }

                const init = { method, headers };
                if (bodyEl && method !== 'GET') {
                    init.body = bodyText ? bodyText : '{}';
                }

                const started = performance.now();
                const resp = await fetch(url, init);
                const elapsed = Math.round(performance.now() - started);
                const ct = resp.headers.get('content-type') || '';
                const metaEl = modal.querySelector('#api-response-meta');
                metaEl.textContent = `${resp.status} ${resp.statusText} • ${elapsed} ms`;
                const bodyOut = modal.querySelector('#api-response-body');
                let text;
                if (ct.includes('application/json')) {
                    const obj = await resp.json().catch(() => ({}));
                    text = JSON.stringify(obj, null, 2);
                    bodyOut.classList.add('language-json');
                } else {
                    text = await resp.text();
                    bodyOut.classList.remove('language-json');
                }
                bodyOut.textContent = text;
                if (window.hljs && bodyOut.classList.contains('language-json')) {
                    try { hljs.highlightElement(bodyOut); } catch (e) {}
                }
            } catch (err) {
                const metaEl = modal.querySelector('#api-response-meta');
                const bodyOut = modal.querySelector('#api-response-body');
                metaEl.textContent = 'Request failed';
                bodyOut.textContent = String(err.message || err);
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send';
            }
        });
    }

    // Dynamically load external scripts once (used for GraphiQL UMD assets)
    loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') return resolve();
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', (e) => reject(e));
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.crossOrigin = 'anonymous';
            script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); });
            script.addEventListener('error', (e) => reject(e));
            document.body.appendChild(script);
        });
    }

    async ensureGraphiQLAssets() {
        // Try multiple CDNs to be resilient to outages/firewalls
        const reactSources = [
            'https://unpkg.com/react@18.2.0/umd/react.production.min.js',
            'https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js',
        ];
        const reactDomSources = [
            'https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
            'https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js',
        ];
        const graphiqlSources = [
            'https://unpkg.com/graphiql@2.4.0/graphiql.min.js',
            'https://cdn.jsdelivr.net/npm/graphiql@2.4.0/graphiql.min.js',
        ];

        const tryAny = async (sources, globalCheck) => {
            if (globalCheck()) return; // already present
            let lastErr = null;
            for (const src of sources) {
                try {
                    await this.loadScriptOnce(src);
                    if (globalCheck()) return; // success
                } catch (err) {
                    lastErr = err;
                }
            }
            if (lastErr) throw lastErr;
        };

        try {
            await tryAny(reactSources, () => !!window.React);
            await tryAny(reactDomSources, () => !!window.ReactDOM);
            await tryAny(graphiqlSources, () => !!window.GraphiQL);
        } catch (e) {
            console.warn('Failed loading GraphiQL assets dynamically from all sources:', e);
        }
    }

    async renderGraphQL(rerender = false) {
        try {
            const container = document.getElementById('graphiql');
            if (!container) return;

            // Try to ensure assets are present (network/CDN hiccups)
            await this.ensureGraphiQLAssets();

            // Ensure required libraries are loaded
            if (!window.React || !window.ReactDOM || !window.GraphiQL) {
                console.warn('GraphiQL assets not loaded');
                container.innerHTML = '<div class="p-4 text-sm text-gray-600 dark:text-dark-text-secondary">GraphiQL assets failed to load.</div>';
                return;
            }

            // Unmount previous instance if re-rendering (e.g., theme change)
            if (rerender) {
                if (this._graphiqlRoot && this._graphiqlRoot.unmount) {
                    try { this._graphiqlRoot.unmount(); } catch (e) {}
                } else if (window.ReactDOM && window.ReactDOM.unmountComponentAtNode) {
                    try { window.ReactDOM.unmountComponentAtNode(container); } catch (e) {}
                }
                container.innerHTML = '';
            } else {
                container.innerHTML = '';
            }

            const getAuthHeaders = () => {
                const headers = {};
                const token = localStorage.getItem('authToken');
                const apiKey = localStorage.getItem('activeApiKey');
                if (token) headers['Authorization'] = `Bearer ${token}`;
                if (!token && apiKey) headers['X-API-Key'] = apiKey;
                return headers;
            };

            const fetcher = async (graphQLParams, opts = {}) => {
                const editorHeaders = (opts && opts.headers) ? opts.headers : {};
                const baseAuthHeaders = getAuthHeaders();
                const usedToken = !!baseAuthHeaders['Authorization'];
                const usedApiKey = !!baseAuthHeaders['X-API-Key'];
                const headers = {
                    'Content-Type': 'application/json',
                    ...baseAuthHeaders,
                    ...editorHeaders,
                };
                const resp = await fetch('/api/graphql', {
                    method: 'POST',
                    headers,
                    credentials: 'same-origin',
                    body: JSON.stringify(graphQLParams),
                });
                if (resp.status === 401 || resp.status === 403) {
                    let msg = '';
                    try {
                        const obj = await resp.json();
                        msg = (obj && (obj.error || obj.message)) ? (obj.error || obj.message) : '';
                    } catch (e) {}
                    if (usedToken) {
                        this.handleAuthFailure(resp.status, msg, 'token');
                    } else if (usedApiKey) {
                        this.handleAuthFailure(resp.status, msg || 'Invalid or expired API key', 'apiKey');
                    }
                    return { errors: [{ message: msg || (resp.status === 401 ? 'Unauthorized' : 'Forbidden') }] };
                }
                const ct = resp.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    return resp.json();
                }
                const text = await resp.text();
                try { return JSON.parse(text); } catch { return { errors: [{ message: text }] }; }
            };

            const isDark = document.documentElement.classList.contains('dark');
            const headersForEditor = getAuthHeaders();
            const headersString = Object.keys(headersForEditor).length
                ? JSON.stringify(headersForEditor, null, 2)
                : '{\n  \n}';

            const props = {
                fetcher,
                headers: headersString,
                defaultEditorToolsVisibility: true,
                shouldPersistHeaders: true,
                theme: isDark ? 'dark' : 'light',
            };

            const element = window.React.createElement(window.GraphiQL, props);

            if (window.ReactDOM.createRoot) {
                this._graphiqlRoot = window.ReactDOM.createRoot(container);
                this._graphiqlRoot.render(element);
            } else {
                window.ReactDOM.render(element, container);
                this._graphiqlRoot = null;
            }
        } catch (err) {
            console.error('Failed to render GraphiQL:', err);
            this.showError('Failed to initialize GraphQL Explorer');
        }
    }

    viewUserCommits(email) {
        document.getElementById('commits-user').value = email;
        this.navigateTo('commits');
        // Trigger search after navigation
        setTimeout(() => {
            document.getElementById('commits-filter-form').dispatchEvent(new Event('submit'));
        }, 100);
    }

    async viewRepositoryStats(repositoryId) {
        try {
            const stats = await this.apiCall(`/api/git/repositories/${repositoryId}/stats`);
            alert(`Repository Stats:\nTotal Commits: ${stats.totalCommits}\nContributors: ${stats.contributors}\nBranches: ${stats.branches}`);
        } catch (error) {
            console.error('Error loading repository stats:', error);
            this.showError('Failed to load repository stats');
        }
    }

    showLoading() {
        document.getElementById('loading').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    showError(message) {
        // Create a simple error notification
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showSuccess(message) {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    handleAuthFailure(status, message, source = 'token') {
        const defaultMsg = status === 401
            ? 'Your session has expired or is invalid. Please log in again.'
            : 'You do not have permission to perform this action.';
        const msg = message || defaultMsg;

        if (source === 'token') {
            this.logout();
        } else if (source === 'apiKey') {
            try { localStorage.removeItem('activeApiKey'); } catch (e) {}
        }

        this.showError(msg);
    }

    async apiCall(endpoint, options = {}) {
        const token = localStorage.getItem('authToken');
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        };

        const response = await fetch(endpoint, { ...defaultOptions, ...options });

        if (response.status === 401 || response.status === 403) {
            let errMsg = '';
            try {
                const err = await response.json();
                errMsg = err && (err.error || err.message) ? (err.error || err.message) : '';
            } catch (e) {}
            this.handleAuthFailure(response.status, errMsg, 'token');
            throw new Error(errMsg || (response.status === 401 ? 'Unauthorized' : 'Forbidden'));
        }

        if (!response.ok) {
            let errorText = 'API request failed';
            try {
                const err = await response.json();
                errorText = (err && (err.error || err.message)) ? (err.error || err.message) : errorText;
            } catch (e) {}
            throw new Error(errorText);
        }

        return response.json();
    }

    logout() {
        localStorage.removeItem('authToken');
        this.currentUser = null;
        this.showLoginModal();
    }
}

// Initialize the app
const app = new GitInsiderApp();
