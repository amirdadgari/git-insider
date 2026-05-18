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
        document.getElementById('setting-retention-days').value = s.retention_idle_days || '7';
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
                        retention_idle_days: document.getElementById('setting-retention-days').value,
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

    async loadAnalyticsPage() {
        const form = document.getElementById('analytics-filter-form');
        if (form && !form.dataset.bound) {
            form.dataset.bound = '1';
            const end = new Date();
            const start = new Date();
            start.setMonth(start.getMonth() - 3);
            document.getElementById('analytics-end-date').value = end.toISOString().slice(0, 10);
            document.getElementById('analytics-start-date').value = start.toISOString().slice(0, 10);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.renderAnalytics();
            });
        }
        await this.renderAnalytics();
    },

    async renderAnalytics() {
        const container = document.getElementById('analytics-content');
        if (!container) return;

        const startDate = document.getElementById('analytics-start-date')?.value;
        const endDate = document.getElementById('analytics-end-date')?.value;
        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        try {
            const data = await app.apiCall(`/api/git/analytics?${params}`);
            container.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">${ui.statTiles([
                    { label: 'Files changed', value: data.filesChanged, tone: 'text-gray-900 dark:text-dark-text' },
                    { label: 'Lines added', value: '+' + data.totalAdditions, tone: 'text-green-600 dark:text-green-400' },
                    { label: 'Lines deleted', value: '-' + data.totalDeletions, tone: 'text-red-600 dark:text-red-400' },
                    { label: 'Recent commits', value: data.recentCommits.length, tone: 'text-git-blue' }
                ])}</div></div>
                ${this._barChart('Commits over time', data.commitsOverTime, 'count')}
                ${this._linesChart('Lines over time', data.linesOverTime)}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    ${this._rankList('Top contributors', data.topContributors, 'name', 'commit_count')}
                    ${this._rankList('Top repositories', data.topRepositories, 'name', 'commit_count')}
                </div>
                <div class="card">
                    <h3 class="card-title mb-3">Recent commits</h3>
                    <div class="space-y-2">
                        ${(data.recentCommits || []).map((c) => `
                            <div class="text-sm border-b border-gray-100 dark:border-gray-700 pb-2">
                                <span class="font-mono text-xs">${(c.hash || '').slice(0, 7)}</span>
                                ${platformPages._escape(c.message || '')}
                                <span class="text-gray-500 dark:text-dark-text-secondary"> — ${platformPages._escape(c.author || '')} · ${platformPages._escape(c.repository || '')}</span>
                            </div>
                        `).join('') || ui.emptyState('No commits in range. Scan workspaces and index repos first.')}
                    </div>
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<p class="text-red-500 dark:text-red-400 text-sm">${platformPages._escape(err.message)}</p>`;
        }
    },

    _barChart(title, buckets, valueKey) {
        if (!buckets || !buckets.length) {
            return `<div class="card"><h3 class="card-title mb-2">${title}</h3><p class="empty-state py-4">No data</p></div>`;
        }
        const max = Math.max(...buckets.map((b) => b[valueKey] || 0), 1);
        return `<div class="card"><h3 class="card-title mb-3">${title}</h3>
            <div class="flex items-end gap-1 h-32">
                ${buckets.map((b) => {
                    const h = Math.round(((b[valueKey] || 0) / max) * 100);
                    return `<div class="flex-1 flex flex-col items-center" title="${b.bucket}: ${b[valueKey]}">
                        <div class="w-full bg-git-blue rounded-t" style="height:${h}%"></div>
                        <span class="text-[10px] mt-1 truncate w-full text-center">${(b.bucket || '').slice(5)}</span>
                    </div>`;
                }).join('')}
            </div></div>`;
    },

    _linesChart(title, buckets) {
        if (!buckets || !buckets.length) {
            return `<div class="card"><h3 class="card-title mb-2">${title}</h3><p class="empty-state py-4">No data (enable file stats via includeChanges when indexing)</p></div>`;
        }
        const max = Math.max(...buckets.map((b) => (b.additions || 0) + (b.deletions || 0)), 1);
        return `<div class="card"><h3 class="card-title mb-3">${title}</h3>
            <div class="flex items-end gap-1 h-32">
                ${buckets.map((b) => {
                    const total = (b.additions || 0) + (b.deletions || 0);
                    const h = Math.round((total / max) * 100);
                    return `<div class="flex-1 flex flex-col items-center" title="+${b.additions}/-${b.deletions}">
                        <div class="w-full bg-purple-500 rounded-t" style="height:${h}%"></div>
                        <span class="text-[10px] mt-1">${(b.bucket || '').slice(5)}</span>
                    </div>`;
                }).join('')}
            </div></div>`;
    },

    _rankList(title, items, labelKey, countKey) {
        return `<div class="card"><h3 class="font-semibold mb-3 text-gray-900 dark:text-dark-text">${title}</h3>
            <ol class="space-y-1 text-sm text-gray-700 dark:text-dark-text">
                ${(items || []).map((i, idx) => `<li>${idx + 1}. ${platformPages._escape(i[labelKey])} <span class="text-gray-500 dark:text-dark-text-secondary">(${i[countKey]})</span></li>`).join('') || '<li class="text-gray-500 dark:text-dark-text-secondary">No data</li>'}
            </ol></div>`;
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
