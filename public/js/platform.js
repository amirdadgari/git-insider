// Settings, Analytics, Contributors pages
const platformPages = {
    gitlabFormPayload() {
        const token = document.getElementById('gitlab-token').value.trim();
        return {
            baseUrl: document.getElementById('gitlab-base-url').value.trim(),
            privateToken: token || undefined,
            enabled: document.getElementById('gitlab-enabled').checked
        };
    },

    setGitlabBusy(busy) {
        ['gitlab-test-btn', 'gitlab-sync-btn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = busy;
        });
    },

    updateGitlabStatus(text) {
        const el = document.getElementById('gitlab-status');
        if (el) el.textContent = text;
    },

    async loadSettingsPage() {
        const form = document.getElementById('settings-form');
        if (!form || form.dataset.bound) return;
        form.dataset.bound = '1';

        const data = await app.apiCall('/api/admin/settings');
        const s = data.settings || {};
        document.getElementById('setting-index-window').value = s.index_window_months || '3';
        document.getElementById('setting-scan-interval').value = s.workspace_scan_interval_minutes || '30';
        if (data.scheduler) {
            document.getElementById('scheduler-status').textContent =
                `Last workspace scan: ${data.scheduler.last_workspace_scan_at || 'never'}`;
        }

        try {
            const gitlab = await app.apiCall('/api/admin/gitlab');
            if (gitlab && gitlab.base_url) {
                document.getElementById('gitlab-base-url').value = gitlab.base_url;
                document.getElementById('gitlab-enabled').checked = !!gitlab.enabled;
                this.updateGitlabStatus(
                    `Configured · ${gitlab.enabled ? 'enabled' : 'disabled'} · Last sync: ${gitlab.last_sync_at || 'never'}`
                );
            } else {
                this.updateGitlabStatus('Not configured');
            }
        } catch (_) {
            this.updateGitlabStatus('Not configured');
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await app.apiCall('/api/admin/settings', {
                    method: 'PUT',
                    body: JSON.stringify({
                        index_window_months: document.getElementById('setting-index-window').value,
                        workspace_scan_interval_minutes: document.getElementById('setting-scan-interval').value
                    })
                });
                await app.apiCall('/api/admin/gitlab', {
                    method: 'PUT',
                    body: JSON.stringify(this.gitlabFormPayload())
                });
                document.getElementById('gitlab-token').value = '';
                const gitlab = await app.apiCall('/api/admin/gitlab');
                this.updateGitlabStatus(
                    `Configured · ${gitlab.enabled ? 'enabled' : 'disabled'} · Last sync: ${gitlab.last_sync_at || 'never'}`
                );
                app.showSuccess('Settings saved');
            } catch (err) {
                app.showError(err.message);
            }
        });

        document.getElementById('gitlab-test-btn').addEventListener('click', async () => {
            this.setGitlabBusy(true);
            try {
                const r = await app.apiCall('/api/admin/gitlab/test', {
                    method: 'POST',
                    body: JSON.stringify(this.gitlabFormPayload())
                });
                const label = r.name ? `${r.name} (@${r.username})` : r.username;
                this.updateGitlabStatus(`Connection OK — ${label}`);
                app.showSuccess(`Connected as ${r.username}`);
            } catch (err) {
                app.showError(err.message);
            } finally {
                this.setGitlabBusy(false);
            }
        });

        document.getElementById('gitlab-sync-btn').addEventListener('click', async () => {
            const payload = this.gitlabFormPayload();
            if (!payload.enabled) {
                app.showError('Enable GitLab integration (checkbox) before syncing users');
                return;
            }
            this.setGitlabBusy(true);
            try {
                const r = await app.apiCall('/api/admin/gitlab/sync-users', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                document.getElementById('gitlab-token').value = '';
                const gitlab = await app.apiCall('/api/admin/gitlab');
                this.updateGitlabStatus(
                    `Configured · enabled · Last sync: ${gitlab.last_sync_at || 'just now'} · ${r.synced} users`
                );
                app.showSuccess(`Synced ${r.synced} users`);
            } catch (err) {
                app.showError(err.message);
            } finally {
                this.setGitlabBusy(false);
            }
        });

        document.getElementById('trigger-index-btn').addEventListener('click', async () => {
            try {
                await app.apiCall('/api/git/index', { method: 'POST' });
                app.showSuccess('Indexing started — watch the progress bar at the top');
                if (window.indexProgressPoller) indexProgressPoller.poll();
            } catch (err) {
                app.showError(err.message);
            }
        });
    },

    _currentWeekRange() {
        const now = new Date();
        const day = now.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fmt = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        return { start: fmt(monday), end: fmt(sunday) };
    },

    _setAnalyticsDateRange(start, end) {
        const startEl = document.getElementById('analytics-start-date');
        const endEl = document.getElementById('analytics-end-date');
        if (startEl) startEl.value = start;
        if (endEl) endEl.value = end;
    },

    async loadAnalyticsPage() {
        const form = document.getElementById('analytics-filter-form');
        if (form && !form.dataset.bound) {
            form.dataset.bound = '1';
            const { start, end } = this._currentWeekRange();
            this._setAnalyticsDateRange(start, end);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.renderAnalytics();
            });
            ['analytics-start-date', 'analytics-end-date'].forEach((id) => {
                document.getElementById(id)?.addEventListener('change', () => this.renderAnalytics());
            });
            if (window.analyticsCharts) {
                analyticsCharts.bindThemeRefresh(() => this.renderAnalytics());
            }
        }
        await this.renderAnalytics();
    },

    _analyticsStatTiles(data) {
        const fmt = window.analyticsCharts?.fmtNum || ((n) => String(n ?? 0));
        const totalCommits = (data.commitsOverTime || []).reduce((s, b) => s + (b.count || 0), 0);
        return [
            { label: 'Commits', value: fmt(totalCommits), accent: 'stat-tile-accent-blue', tone: 'text-git-blue' },
            { label: 'Files changed', value: fmt(data.filesChanged), accent: 'stat-tile-accent-purple', tone: 'text-gray-900 dark:text-dark-text' },
            { label: 'Lines added', value: '+' + fmt(data.totalAdditions), accent: 'stat-tile-accent-green', tone: 'text-green-600 dark:text-green-400' },
            { label: 'Lines deleted', value: '−' + fmt(data.totalDeletions), accent: 'stat-tile-accent-red', tone: 'text-red-600 dark:text-red-400' }
        ].map((t) => `
            <div class="stat-tile ${t.accent}">
                <p class="stat-tile-label">${platformPages._escape(t.label)}</p>
                <p class="stat-tile-value ${t.tone}">${platformPages._escape(t.value)}</p>
            </div>
        `).join('');
    },

    _analyticsEmptyChartCard(title, message) {
        return `
            <div class="card analytics-chart-card">
                <h3 class="card-title mb-2">${title}</h3>
                <p class="empty-state py-8">${platformPages._escape(message)}</p>
            </div>
        `;
    },

    _formatCommitDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch (_) {
            return iso;
        }
    },

    _renderRecentCommits(commits) {
        if (!commits?.length) {
            return ui.emptyState('No commits in this range. Scan workspaces and index repos first.');
        }
        return commits.map((c) => {
            const msg = (c.message || '').split('\n')[0];
            const truncated = msg.length > 120 ? `${msg.slice(0, 118)}…` : msg;
            const author = c.contributorName || c.author || 'Unknown';
            return `
                <article class="analytics-commit-row">
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="analytics-hash">${platformPages._escape((c.hash || '').slice(0, 7))}</span>
                        <time class="text-xs text-gray-500 dark:text-dark-text-secondary whitespace-nowrap">${platformPages._escape(this._formatCommitDate(c.date))}</time>
                    </div>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm text-gray-900 dark:text-dark-text leading-snug">${platformPages._escape(truncated)}</p>
                        <p class="text-xs text-gray-500 dark:text-dark-text-secondary mt-1">
                            ${platformPages._escape(author)} · ${platformPages._escape(c.repository || '')}
                        </p>
                    </div>
                </article>
            `;
        }).join('');
    },

    _buildAnalyticsLayout(data) {
        const ac = window.analyticsCharts;
        const commitsChart = (data.commitsOverTime || []).length && ac
            ? ac.chartCard('Commits over time', 'chart-commits', 'Daily commit volume')
            : this._analyticsEmptyChartCard('Commits over time', 'No commits in this date range.');
        const linesChart = (data.linesOverTime || []).length && ac
            ? ac.chartCard('Lines changed', 'chart-lines', 'Additions and deletions per day')
            : this._analyticsEmptyChartCard(
                'Lines changed',
                'No line stats yet for this range. Use Re-index All Repos in Settings to backfill.'
            );
        const contribChart = (data.topContributors || []).length && ac
            ? ac.chartCard('Top contributors', 'chart-contributors', null, { tall: true })
            : this._analyticsEmptyChartCard('Top contributors', 'No contributor data in range.');
        const reposChart = (data.topRepositories || []).length && ac
            ? ac.chartCard('Top repositories', 'chart-repositories', null, { tall: true })
            : this._analyticsEmptyChartCard('Top repositories', 'No repository activity in range.');

        return `
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                ${this._analyticsStatTiles(data)}
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
                ${commitsChart}
                ${linesChart}
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                ${contribChart}
                ${reposChart}
            </div>
            <div class="card">
                <div class="flex items-center justify-between gap-3 mb-4">
                    <h3 class="card-title">Recent commits</h3>
                    <span class="badge badge-gray">${(data.recentCommits || []).length} shown</span>
                </div>
                <div>${this._renderRecentCommits(data.recentCommits)}</div>
            </div>
        `;
    },

    async renderAnalytics() {
        const container = document.getElementById('analytics-content');
        if (!container) return;

        const startDate = document.getElementById('analytics-start-date')?.value;
        const endDate = document.getElementById('analytics-end-date')?.value;
        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        if (window.analyticsCharts) analyticsCharts.destroyAll();
        container.innerHTML = `
            <div class="flex items-center justify-center py-16 text-sm text-gray-500 dark:text-dark-text-secondary">
                <svg class="animate-spin w-5 h-5 mr-2 text-git-blue" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Loading analytics…
            </div>
        `;

        try {
            const data = await app.apiCall(`/api/git/analytics?${params}`);
            container.innerHTML = this._buildAnalyticsLayout(data);
            requestAnimationFrame(() => {
                if (window.analyticsCharts) {
                    analyticsCharts.mountAll(data, { startDate, endDate });
                }
            });
        } catch (err) {
            container.innerHTML = `<p class="text-red-500 dark:text-red-400 text-sm">${platformPages._escape(err.message)}</p>`;
        }
    },

    async loadContributorsPage() {
        if (window.contributorsUi) {
            return contributorsUi.loadContributorsPage();
        }
        const listEl = document.getElementById('contributors-list');
        if (listEl) listEl.innerHTML = '<p class="text-sm text-gray-500 dark:text-dark-text-secondary">Loading…</p>';
    },

    _escape(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }
};

window.platformPages = platformPages;
