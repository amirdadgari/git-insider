// Git Analytics JavaScript
class GitAnalytics {
    constructor() {
        this.setupEventListeners();
        this.currentCommitsData = [];
        this.currentChangesData = [];
    }

    setupEventListeners() {
        // Commits form
        document.getElementById('commits-filter-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.searchCommits();
        });

        document.getElementById('commits-reset').addEventListener('click', () => {
            this.resetCommitsForm();
        });

        // Code changes form
        document.getElementById('changes-filter-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.searchCodeChanges();
        });

        document.getElementById('changes-reset').addEventListener('click', () => {
            this.resetChangesForm();
        });
    }

    async searchCommits(page = 1) {
        const user = document.getElementById('commits-user').value;
        const startDate = document.getElementById('commits-start-date').value;
        const endDate = document.getElementById('commits-end-date').value;
        const repository = document.getElementById('commits-repository').value;

        const params = new URLSearchParams({
            page: page.toString(),
            limit: '20'
        });

        if (user) params.append('user', user);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (repository) {
            params.append('repositories', repository);
        }

        app.showLoading();

        try {
            const response = await app.apiCall(`/api/git/commits?${params}`);
            this.currentCommitsData = response;
            this.displayCommitsResults(response);
            this.displayCommitsPagination(response.pagination);
        } catch (error) {
            app.showError('Failed to search commits: ' + error.message);
            this.displayCommitsResults({ commits: [], pagination: { total: 0 } });
        } finally {
            app.hideLoading();
        }
    }

    displayCommitsResults(data) {
        const container = document.getElementById('commits-results');
        const countContainer = document.getElementById('commits-count');

        countContainer.textContent = `${data.pagination?.total || 0} commits found`;

        if (data.commits.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-gray-500 dark:text-dark-text-secondary">
                        📝 No commits found matching your criteria
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = data.commits.map(commit => `
            <div class="commit-card">
                <div class="flex items-start justify-between">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start space-x-3">
                            <div class="flex-shrink-0">
                                <div class="w-10 h-10 bg-git-blue rounded-full flex items-center justify-center text-white text-sm font-medium">
                                    ${commit.author.charAt(0).toUpperCase()}
                                </div>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium text-gray-900 dark:text-dark-text">
                                    ${this.escapeHtml(commit.message)}
                                </div>
                                <div class="flex items-center space-x-2 text-xs text-gray-500 dark:text-dark-text-secondary mt-1">
                                    <span>${this.escapeHtml(commit.author)}</span>
                                    <span>•</span>
                                    <span>${this.formatDate(commit.date)}</span>
                                    <span>•</span>
                                    <span class="badge badge-primary text-xs">${this.escapeHtml(commit.repository)}</span>
                                </div>
                                ${commit.authorEmail ? `
                                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                        ${this.escapeHtml(commit.authorEmail)}
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2 ml-4">
                        <span class="badge badge-gray text-xs font-mono">${commit.hash.substring(0, 7)}</span>
                        <button onclick="gitAnalytics.viewCommitDetails('${commit.repositoryId || ''}', '${commit.hash}', ${commit.repositoryPath ? `'${commit.repositoryPath.replace(/\\/g, '\\\\')}'` : 'null'})" 
                                class="btn btn-secondary btn-sm">
                            View Details
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    displayCommitsPagination(pagination) {
        const container = document.getElementById('commits-pagination');
        
        if (pagination.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        const currentPage = pagination.page;
        const totalPages = pagination.totalPages;
        const maxVisible = 5;

        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage + 1 < maxVisible) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        let paginationHtml = `
            <div class="flex items-center space-x-2">
        `;

        // Previous button
        if (currentPage > 1) {
            paginationHtml += `
                <button onclick="gitAnalytics.searchCommits(${currentPage - 1})" 
                        class="btn btn-secondary">Previous</button>
            `;
        }

        // Page numbers
        for (let page = startPage; page <= endPage; page++) {
            const isActive = page === currentPage;
            paginationHtml += `
                <button onclick="gitAnalytics.searchCommits(${page})" 
                        class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}">${page}</button>
            `;
        }

        // Next button
        if (currentPage < totalPages) {
            paginationHtml += `
                <button onclick="gitAnalytics.searchCommits(${currentPage + 1})" 
                        class="btn btn-secondary">Next</button>
            `;
        }

        paginationHtml += `</div>`;
        container.innerHTML = paginationHtml;
    }

    async searchCodeChanges(page = 1) {
        const user = document.getElementById('changes-user').value;
        const startDate = document.getElementById('changes-start-date').value;
        const endDate = document.getElementById('changes-end-date').value;
        const repository = document.getElementById('changes-repository').value;

        const params = new URLSearchParams({
            page: page.toString(),
            limit: '20'
        });

        if (user) params.append('user', user);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (repository) {
            params.append('repositories', repository);
        }

        app.showLoading();

        try {
            const response = await app.apiCall(`/api/git/code-changes?${params}`);
            this.currentChangesData = response;
            this.displayCodeChangesResults(response);
            this.displayCodeChangesPagination(response.pagination);
        } catch (error) {
            app.showError('Failed to search code changes: ' + error.message);
            this.displayCodeChangesResults({ changes: [], pagination: { total: 0 } });
        } finally {
            app.hideLoading();
        }
    }

    displayCodeChangesResults(data) {
        const container = document.getElementById('changes-results');
        const countContainer = document.getElementById('changes-count');

        countContainer.textContent = `${data.pagination?.total || 0} code changes found`;

        if (data.changes.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-gray-500 dark:text-dark-text-secondary">
                        🔄 No code changes found matching your criteria
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = data.changes.map(change => {
            const totalAdditions = change.files.reduce((sum, file) => sum + file.additions, 0);
            const totalDeletions = change.files.reduce((sum, file) => sum + file.deletions, 0);

            return `
                <div class="commit-card">
                    <div class="flex items-start justify-between">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-start space-x-3">
                                <div class="flex-shrink-0">
                                    <div class="w-10 h-10 bg-git-purple rounded-full flex items-center justify-center text-white text-sm font-medium">
                                        ${change.author.charAt(0).toUpperCase()}
                                    </div>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-medium text-gray-900 dark:text-dark-text">
                                        ${this.escapeHtml(change.message)}
                                    </div>
                                    <div class="flex items-center space-x-2 text-xs text-gray-500 dark:text-dark-text-secondary mt-1">
                                        <span>${this.escapeHtml(change.author)}</span>
                                        <span>•</span>
                                        <span>${this.formatDate(change.date)}</span>
                                        <span>•</span>
                                        <span class="badge badge-primary text-xs">${this.escapeHtml(change.repository)}</span>
                                    </div>
                                    ${change.files.length > 0 ? `
                                        <div class="mt-3 border-t border-gray-200 dark:border-dark-border pt-3">
                                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                ${change.files.slice(0, 6).map(file => `
                                                    <div class="flex items-center justify-between text-xs">
                                                        <span class="font-mono truncate mr-2 file-diff-link cursor-pointer text-git-blue hover:underline"
                                                              data-repo-id="${change.repositoryId || ''}"
                                                              data-repo-path="${change.repositoryPath ? encodeURIComponent(change.repositoryPath) : ''}"
                                                              data-hash="${change.hash}"
                                                              data-file="${encodeURIComponent(file.filename)}">
                                                            ${this.escapeHtml(file.filename)}
                                                        </span>
                                                        <div class="flex-shrink-0">
                                                            <span class="text-git-green">+${file.additions}</span>
                                                            <span class="text-git-red">-${file.deletions}</span>
                                                        </div>
                                                    </div>
                                                `).join('')}
                                                ${change.files.length > 6 ? `
                                                    <div class="text-xs text-gray-500 dark:text-dark-text-secondary">
                                                        ... and ${change.files.length - 6} more files
                                                    </div>
                                                ` : ''}
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center space-x-2 ml-4">
                            <span class="badge badge-gray text-xs font-mono">${change.hash.substring(0, 7)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Bind click handlers for per-file diffs
        container.querySelectorAll('.file-diff-link').forEach(el => {
            el.addEventListener('click', (e) => {
                const repoIdAttr = e.currentTarget.getAttribute('data-repo-id');
                const repoPathAttr = e.currentTarget.getAttribute('data-repo-path');
                const hash = e.currentTarget.getAttribute('data-hash');
                const file = decodeURIComponent(e.currentTarget.getAttribute('data-file') || '');
                const repoId = repoIdAttr ? parseInt(repoIdAttr, 10) : null;
                const repoPath = repoPathAttr ? decodeURIComponent(repoPathAttr) : null;
                this.viewFileDiff(repoId, hash, file, repoPath);
            });
        });
    }

    displayCodeChangesPagination(pagination) {
        const container = document.getElementById('changes-pagination');
        
        if (pagination.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        const currentPage = pagination.page;
        const totalPages = pagination.totalPages;
        const maxVisible = 5;

        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage + 1 < maxVisible) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        let paginationHtml = `
            <div class="flex items-center space-x-2">
        `;

        // Previous button
        if (currentPage > 1) {
            paginationHtml += `
                <button onclick="gitAnalytics.searchCodeChanges(${currentPage - 1})" 
                        class="btn btn-secondary">Previous</button>
            `;
        }

        // Page numbers
        for (let page = startPage; page <= endPage; page++) {
            const isActive = page === currentPage;
            paginationHtml += `
                <button onclick="gitAnalytics.searchCodeChanges(${page})" 
                        class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}">${page}</button>
            `;
        }

        // Next button
        if (currentPage < totalPages) {
            paginationHtml += `
                <button onclick="gitAnalytics.searchCodeChanges(${currentPage + 1})" 
                        class="btn btn-secondary">Next</button>
            `;
        }

        paginationHtml += `</div>`;
        container.innerHTML = paginationHtml;
    }

    async viewCommitDetails(repositoryId, commitHash, repositoryPath = null) {
        try {
            let details;
            if (repositoryId) {
                details = await app.apiCall(`/api/git/commits/${repositoryId}/${commitHash}`);
            } else if (repositoryPath) {
                const params = new URLSearchParams({ repoPath: repositoryPath, hash: commitHash });
                details = await app.apiCall(`/api/git/commits/by-path?${params}`);
            } else {
                throw new Error('Missing repository identifier');
            }
            
            const modal = document.createElement('div');
            modal.id = 'commit-details-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
            
            modal.innerHTML = `
                <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-2xl font-bold text-gray-900 dark:text-dark-text">Commit Details</h2>
                        <button onclick="this.closest('#commit-details-modal').remove()" 
                                class="text-gray-500 hover:text-gray-700">✕</button>
                    </div>
                    
                    <div class="space-y-4">
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-dark-text mb-2">Repository</h3>
                            <p class="text-gray-600 dark:text-dark-text-secondary">${this.escapeHtml(details.repository)}</p>
                        </div>
                        
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-dark-text mb-2">Commit Hash</h3>
                            <p class="font-mono text-sm text-gray-600 dark:text-dark-text-secondary">${this.escapeHtml(details.hash)}</p>
                        </div>
                        
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-dark-text mb-2">Details</h3>
                            <pre class="p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap"><code class="hljs">${this.escapeHtml(details.details)}</code></pre>
                        </div>
                        
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-dark-text mb-2">Changed Files</h3>
                            <pre class="p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap"><code class="hljs">${this.escapeHtml(details.changedFiles)}</code></pre>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            // Highlight dynamically inserted blocks
            if (window.hljs) {
                modal.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
            }
        } catch (error) {
            app.showError('Failed to load commit details: ' + error.message);
        }
    }

    async viewFileDiff(repositoryId, commitHash, filePath, repositoryPath = null) {
        try {
            app.showLoading();
            let url = '';
            if (repositoryId) {
                const qp = new URLSearchParams({ filePath: filePath });
                url = `/api/git/diff/${repositoryId}/${encodeURIComponent(commitHash)}?${qp.toString()}`;
            } else if (repositoryPath) {
                const qp = new URLSearchParams({ repoPath: repositoryPath, hash: commitHash, filePath: filePath });
                url = `/api/git/diff/by-path?${qp.toString()}`;
            } else {
                throw new Error('Missing repository identifier');
            }

            const token = localStorage.getItem('authToken');
            const apiKey = localStorage.getItem('activeApiKey');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            else if (apiKey) headers['X-API-Key'] = apiKey;

            const resp = await fetch(url, { headers });
            if (resp.status === 401 || resp.status === 403) {
                let msg = 'Authentication failed';
                try { const j = await resp.json(); msg = j.error || j.message || msg; } catch { try { msg = await resp.text(); } catch { /* noop */ } }
                app.handleAuthFailure(resp.status, msg, token ? 'token' : 'apiKey');
                throw new Error(msg || (resp.status === 401 ? 'Unauthorized' : 'Forbidden'));
            }
            if (!resp.ok) {
                let msg = 'Failed to fetch file diff';
                try { const j = await resp.json(); msg = j.error || msg; } catch { try { msg = await resp.text(); } catch { /* noop */ } }
                throw new Error(msg);
            }

            const diffText = await resp.text();
            const title = `${filePath} — ${commitHash.substring(0, 7)}`;
            this.showDiffModal(title, diffText);
        } catch (error) {
            app.showError(error.message || 'Failed to load diff');
        } finally {
            app.hideLoading();
        }
    }

    showDiffModal(title, diffText) {
        const modal = document.createElement('div');
        modal.id = 'file-diff-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

        modal.innerHTML = `
            <div class="bg-white dark:bg-dark-bg-secondary rounded-lg p-6 max-w-5xl w-full max-h-[80vh] overflow-y-auto">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-dark-text">${this.escapeHtml(title)}</h2>
                    <button class="text-gray-500 hover:text-gray-700" onclick="this.closest('#file-diff-modal').remove()">✕</button>
                </div>
                <pre class="p-4 rounded-lg text-sm overflow-x-auto whitespace-pre"><code class="hljs language-diff">${this.escapeHtml(diffText)}</code></pre>
            </div>
        `;

        document.body.appendChild(modal);
        // Highlight dynamically inserted diff
        if (window.hljs) {
            modal.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
    }

    resetCommitsForm() {
        document.getElementById('commits-user').value = '';
        document.getElementById('commits-start-date').value = '';
        document.getElementById('commits-end-date').value = '';
        document.getElementById('commits-repository').value = '';
        
        // Clear results
        document.getElementById('commits-results').innerHTML = '';
        document.getElementById('commits-count').textContent = '';
        document.getElementById('commits-pagination').innerHTML = '';
    }

    resetChangesForm() {
        document.getElementById('changes-user').value = '';
        document.getElementById('changes-start-date').value = '';
        document.getElementById('changes-end-date').value = '';
        document.getElementById('changes-repository').value = '';
        
        // Clear results
        document.getElementById('changes-results').innerHTML = '';
        document.getElementById('changes-count').textContent = '';
        document.getElementById('changes-pagination').innerHTML = '';
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Today, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    exportCommitsToCSV() {
        if (!this.currentCommitsData || this.currentCommitsData.commits.length === 0) {
            app.showError('No commits data to export');
            return;
        }

        const headers = ['Repository', 'Hash', 'Author', 'Email', 'Date', 'Message'];
        const csvContent = [
            headers.join(','),
            ...this.currentCommitsData.commits.map(commit => [
                `"${commit.repository}"`,
                commit.hash,
                `"${commit.author}"`,
                `"${commit.authorEmail || ''}"`,
                commit.date,
                `"${commit.message.replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        this.downloadCSV(csvContent, 'git-commits.csv');
    }

    exportChangesToCSV() {
        if (!this.currentChangesData || this.currentChangesData.changes.length === 0) {
            app.showError('No changes data to export');
            return;
        }

        const headers = ['Repository', 'Hash', 'Author', 'Email', 'Date', 'Message', 'Files Changed', 'Additions', 'Deletions'];
        const csvContent = [
            headers.join(','),
            ...this.currentChangesData.changes.map(change => {
                const totalAdditions = change.files.reduce((sum, file) => sum + file.additions, 0);
                const totalDeletions = change.files.reduce((sum, file) => sum + file.deletions, 0);
                
                return [
                    `"${change.repository}"`,
                    change.hash,
                    `"${change.author}"`,
                    `"${change.email || ''}"`,
                    change.date,
                    `"${change.message.replace(/"/g, '""')}"`,
                    change.files.length,
                    totalAdditions,
                    totalDeletions
                ].join(',');
            })
        ].join('\n');

        this.downloadCSV(csvContent, 'git-code-changes.csv');
    }

    downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }
}

// Initialize git analytics
const gitAnalytics = new GitAnalytics();
