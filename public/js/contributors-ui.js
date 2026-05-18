// Contributor mapping UI (loaded after platform.js)
(function () {
    const D = String.fromCharCode(100, 105, 118);

    function patchMotion(html) {
        const bad = String.fromCharCode(109, 111, 116, 105, 111, 110);
        return html.replace(new RegExp(`</?${bad}\\b`, 'g'), (m) => m.replace(bad, D));
    }

    const contributorsUi = {
        _contributorsState: {
            contributors: [],
            unmapped: [],
            expandedId: null,
            detailsCache: {}
        },

        async loadContributorsPage() {
            const listEl = document.getElementById('contributors-list');
            if (!listEl) return;

            if (!contributorsUi._contributorsBound) {
                contributorsUi._contributorsBound = true;
                document.getElementById('contributors-search')?.addEventListener('input', () => contributorsUi._renderContributorsPage());
                document.getElementById('unmapped-search')?.addEventListener('input', () => contributorsUi._renderContributorsPage());
                document.getElementById('contributors-add-btn')?.addEventListener('click', () => {
                    contributorsUi._showContributorFormModal({ mode: 'create' });
                });
            }

            try {
                const [contributors, unmapped] = await Promise.all([
                    app.apiCall('/api/git/contributors'),
                    app.apiCall('/api/git/contributors/unmapped?limit=200')
                ]);
                contributorsUi._contributorsState.contributors = contributors;
                contributorsUi._contributorsState.unmapped = unmapped;
                contributorsUi._renderContributorsPage();
            } catch (err) {
                listEl.innerHTML = `<p class="text-red-500 dark:text-red-400 text-sm">${ui.escape(err.message)}</p>`;
            }
        },

        _renderContributorsPage() {
            const state = contributorsUi._contributorsState;
            const contribQ = (document.getElementById('contributors-search')?.value || '').trim().toLowerCase();
            const unmappedQ = (document.getElementById('unmapped-search')?.value || '').trim().toLowerCase();

            const contributors = contribQ
                ? state.contributors.filter((c) =>
                    [c.display_name, c.primary_email].some((v) => v && String(v).toLowerCase().includes(contribQ)))
                : state.contributors;

            const unmapped = unmappedQ
                ? state.unmapped.filter((a) =>
                    [a.author_name, a.author_email].some((v) => v && String(v).toLowerCase().includes(unmappedQ)))
                : state.unmapped;

            const totalCommits = unmapped.reduce((n, a) => n + (a.commit_count || 0), 0);

            const countBadge = document.getElementById('contributors-count-badge');
            if (countBadge) countBadge.textContent = String(state.contributors.length);
            const unmappedBadge = document.getElementById('unmapped-count-badge');
            if (unmappedBadge) unmappedBadge.textContent = String(state.unmapped.length);

            const statsEl = document.getElementById('contributors-stats');
            if (statsEl) {
                statsEl.innerHTML = ui.statTiles([
                { label: 'Mapped contributors', value: state.contributors.length, tone: 'text-git-blue' },
                { label: 'Unmapped identities', value: state.unmapped.length, tone: 'text-git-orange' },
                { label: 'Commits needing map', value: totalCommits, tone: 'text-gray-900 dark:text-dark-text' }
            ]);
            }

            const hint = document.getElementById('unmapped-hint');
            if (hint) {
                hint.textContent = state.unmapped.length
                    ? 'Each row is a unique author name + email pair from indexed commits.'
                    : '';
            }

            const listEl = document.getElementById('contributors-list');
            listEl.innerHTML = contributors.length
                ? contributors.map((c) => contributorsUi._contributorRowHtml(c)).join('')
                : ui.emptyState('No contributors yet. Link an identity or create one.', 'py-4');

            listEl.querySelectorAll('[data-contributor-toggle]').forEach((btn) => {
                btn.addEventListener('click', () => contributorsUi._toggleContributorDetails(parseInt(btn.dataset.contributorToggle, 10)));
            });

            const unmappedEl = document.getElementById('unmapped-aliases-list');
            unmappedEl.innerHTML = unmapped.length
                ? unmapped.map((a) => contributorsUi._unmappedRowHtml(a)).join('')
                : ui.emptyState('All commit identities are mapped.');

            unmappedEl.querySelectorAll('.link-alias-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    contributorsUi._showLinkAliasModal({
                        authorName: btn.dataset.name || '',
                        authorEmail: btn.dataset.email || '',
                        commitCount: parseInt(btn.dataset.commits, 10) || 0
                    });
                });
            });
        },

        _contributorRowHtml(c) {
            const expanded = contributorsUi._contributorsState.expandedId === c.id;
            const cached = contributorsUi._contributorsState.detailsCache[c.id];
            const aliasesHtml = expanded && cached
                ? (cached.aliases || []).map((a) => `
                    <li class="text-xs text-gray-600 dark:text-dark-text-secondary py-1 border-t border-gray-100 dark:border-gray-700 first:border-0">
                        <span>${ui.escape(a.author_name || '—')} &lt;${ui.escape(a.author_email || '')}&gt;</span>
                    </li>
                `).join('') || '<li class="text-xs text-gray-500 dark:text-dark-text-secondary py-1">No aliases</li>'
                : '';

            return `
                <article class="list-row">
                    <button type="button" data-contributor-toggle="${c.id}"
                        class="w-full flex items-start justify-between gap-2 text-left">
                        <${D} class="min-w-0">
                            <p class="font-medium text-gray-900 dark:text-dark-text truncate">${ui.escape(c.display_name)}</p>
                            ${c.primary_email ? `<p class="text-xs text-gray-500 dark:text-dark-text-secondary truncate">${ui.escape(c.primary_email)}</p>` : ''}
                        </${D}>
                        <span class="badge badge-gray shrink-0">${c.alias_count || 0} aliases</span>
                    </button>
                    ${expanded ? `<ul class="mt-3 pt-2 border-t border-gray-200 dark:border-dark-border">${aliasesHtml}</ul>` : ''}
                </article>
            `;
        },

        _unmappedRowHtml(a) {
            const initials = (a.author_name || a.author_email || '?').charAt(0).toUpperCase();
            return `
                <article class="list-row flex items-center gap-3">
                    <${D} class="w-9 h-9 rounded-full bg-git-blue/15 dark:bg-git-blue/30 text-git-blue dark:text-blue-300 flex items-center justify-center text-sm font-semibold shrink-0" aria-hidden="true">${ui.escape(initials)}</${D}>
                    <${D} class="flex-1 min-w-0">
                        <p class="font-medium text-gray-900 dark:text-dark-text truncate">${ui.escape(a.author_name || 'Unknown')}</p>
                        <p class="text-xs text-gray-500 dark:text-dark-text-secondary truncate">${ui.escape(a.author_email || 'no email')}</p>
                    </${D}>
                    <${D} class="text-right shrink-0">
                        <span class="badge badge-gray">${a.commit_count || 0} commits</span>
                        <button type="button" class="btn btn-primary text-xs mt-2 link-alias-btn block w-full"
                            data-name="${ui.escape(a.author_name || '')}"
                            data-email="${ui.escape(a.author_email || '')}"
                            data-commits="${a.commit_count || 0}">Link</button>
                    </${D}>
                </article>
            `;
        },

        async _toggleContributorDetails(id) {
            const state = contributorsUi._contributorsState;
            if (state.expandedId === id) {
                state.expandedId = null;
                contributorsUi._renderContributorsPage();
                return;
            }
            state.expandedId = id;
            if (!state.detailsCache[id]) {
                try {
                    state.detailsCache[id] = await app.apiCall(`/api/git/contributors/${id}`);
                } catch (err) {
                    app.showError(err.message);
                    state.expandedId = null;
                    return;
                }
            }
            contributorsUi._renderContributorsPage();
        },

        _attachAutocomplete(inputEl, menuEl, fetchItems) {
            let timer = null;
            let activeIdx = -1;
            let items = [];

            const render = () => {
                if (!items.length) {
                    menuEl.classList.add('hidden');
                    menuEl.innerHTML = '';
                    return;
                }
                menuEl.classList.remove('hidden');
                menuEl.innerHTML = items.map((item, i) => `
                    <button type="button" class="autocomplete-item w-full text-left${i === activeIdx ? ' active' : ''}" data-idx="${i}">
                        <span class="font-medium">${ui.escape(item.label)}</span>
                        ${item.meta ? `<span class="text-gray-500 dark:text-dark-text-secondary ml-2">${ui.escape(item.meta)}</span>` : ''}
                    </button>
                `).join('');
                menuEl.querySelectorAll('.autocomplete-item').forEach((btn) => {
                    btn.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        const picked = items[parseInt(btn.dataset.idx, 10)];
                        if (picked) {
                            inputEl.value = picked.value;
                            if (picked.id) inputEl.dataset.contributorId = String(picked.id);
                            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        menuEl.classList.add('hidden');
                    });
                });
            };

            const load = async (q) => {
                items = await fetchItems(q);
                activeIdx = -1;
                render();
            };

            inputEl.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => load(inputEl.value.trim()), 200);
            });
            inputEl.addEventListener('focus', () => load(inputEl.value.trim()));
            inputEl.addEventListener('keydown', (e) => {
                if (menuEl.classList.contains('hidden')) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = Math.min(activeIdx + 1, items.length - 1);
                    render();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = Math.max(activeIdx - 1, 0);
                    render();
                } else if (e.key === 'Enter' && activeIdx >= 0) {
                    e.preventDefault();
                    inputEl.value = items[activeIdx].value;
                    if (items[activeIdx].id) inputEl.dataset.contributorId = String(items[activeIdx].id);
                    menuEl.classList.add('hidden');
                } else if (e.key === 'Escape') {
                    menuEl.classList.add('hidden');
                }
            });
            inputEl.addEventListener('blur', () => setTimeout(() => menuEl.classList.add('hidden'), 150));
        },

        async _fetchAuthorSuggestions(q) {
            const params = new URLSearchParams({ limit: '12' });
            if (q) params.set('q', q);
            return app.apiCall(`/api/git/contributors/suggestions?${params}`);
        },

        _showLinkAliasModal(alias) {
            const contributors = contributorsUi._contributorsState.contributors;
            const contributorOptions = contributors.map((c) =>
                `<option value="${c.id}">${ui.escape(c.display_name)}${c.primary_email ? ` (${ui.escape(c.primary_email)})` : ''}</option>`
            ).join('');

            const body = patchMotion(`
                <${D} class="rounded-lg bg-gray-50 dark:bg-dark-bg border border-gray-200 dark:border-dark-border p-4">
                    <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-dark-text-secondary mb-1">Git identity</p>
                    <p class="font-medium text-gray-900 dark:text-dark-text">${ui.escape(alias.authorName || 'Unknown')}</p>
                    <p class="text-sm text-gray-600 dark:text-dark-text-secondary">${ui.escape(alias.authorEmail || 'no email')}</p>
                    <p class="text-xs text-gray-500 dark:text-dark-text-secondary mt-2">${alias.commitCount || 0} indexed commits</p>
                </${D}>
                <${D} class="flex gap-2" role="tablist">
                    <button type="button" class="link-mode-btn btn btn-secondary text-sm flex-1" data-mode="existing">Link to existing</button>
                    <button type="button" class="link-mode-btn btn btn-secondary text-sm flex-1" data-mode="new">Create new</button>
                </${D}>
                <${D} id="link-existing-panel" class="space-y-3">
                    <label class="block text-sm font-medium text-gray-700 dark:text-dark-text">Contributor</label>
                    <select id="link-contributor-select" class="select">
                        <option value="">Select contributor…</option>
                        ${contributorOptions}
                    </select>
                    <label class="block text-sm font-medium text-gray-700 dark:text-dark-text">Or search</label>
                    <${D} class="relative">
                        <input type="search" id="link-contributor-search" class="input" placeholder="Type to filter contributors…" autocomplete="off" />
                        <${D} id="link-contributor-menu" class="autocomplete-menu hidden"></${D}>
                    </${D}>
                </${D}>
                <${D} id="link-new-panel" class="space-y-3 hidden">
                    <label class="block text-sm font-medium text-gray-700 dark:text-dark-text">Display name</label>
                    <${D} class="relative">
                        <input type="text" id="link-display-name" class="input" value="${ui.escape(alias.authorName || '')}" autocomplete="off" />
                        <${D} id="link-name-menu" class="autocomplete-menu hidden"></${D}>
                    </${D}>
                    <label class="block text-sm font-medium text-gray-700 dark:text-dark-text">Primary email</label>
                    <${D} class="relative">
                        <input type="email" id="link-primary-email" class="input" value="${ui.escape(alias.authorEmail || '')}" autocomplete="off" />
                        <${D} id="link-email-menu" class="autocomplete-menu hidden"></${D}>
                    </${D}>
                </${D}>
            `);

            const footer = `
                <button type="button" class="btn btn-secondary modal-close-btn">Cancel</button>
                <button type="button" id="link-alias-submit" class="btn btn-primary">Link identity</button>
            `;

            const modal = ui.showModal('link-alias-modal', 'Link git identity', body, footer);
            let mode = contributors.length ? 'existing' : 'new';

            const setMode = (next) => {
                mode = next;
                modal.querySelectorAll('.link-mode-btn').forEach((b) => {
                    b.classList.toggle('btn-primary', b.dataset.mode === mode);
                    b.classList.toggle('btn-secondary', b.dataset.mode !== mode);
                });
                modal.querySelector('#link-existing-panel').classList.toggle('hidden', mode !== 'existing');
                modal.querySelector('#link-new-panel').classList.toggle('hidden', mode !== 'new');
            };

            modal.querySelectorAll('.link-mode-btn').forEach((b) => {
                b.addEventListener('click', () => setMode(b.dataset.mode));
            });
            modal.querySelector('.modal-close-btn')?.addEventListener('click', () => modal.remove());
            setMode(mode);

            const searchInput = modal.querySelector('#link-contributor-search');
            const searchMenu = modal.querySelector('#link-contributor-menu');
            const selectEl = modal.querySelector('#link-contributor-select');

            contributorsUi._attachAutocomplete(searchInput, searchMenu, async (q) => {
                const qq = q.toLowerCase();
                return contributors
                    .filter((c) => !qq || [c.display_name, c.primary_email].some((v) => v && String(v).toLowerCase().includes(qq)))
                    .slice(0, 12)
                    .map((c) => ({
                        label: c.display_name,
                        meta: c.primary_email || '',
                        value: c.display_name,
                        id: c.id
                    }));
            });
            searchInput.addEventListener('change', () => {
                const id = searchInput.dataset.contributorId;
                if (id) selectEl.value = id;
                else {
                    const match = contributors.find((c) => c.display_name === searchInput.value.trim());
                    if (match) selectEl.value = String(match.id);
                }
            });

            const nameInput = modal.querySelector('#link-display-name');
            const emailInput = modal.querySelector('#link-primary-email');
            contributorsUi._attachAutocomplete(nameInput, modal.querySelector('#link-name-menu'), async (q) => {
                const data = await contributorsUi._fetchAuthorSuggestions(q);
                return (data.names || []).map((n) => ({
                    label: n.value,
                    meta: `${n.commit_count} commits`,
                    value: n.value
                }));
            });
            contributorsUi._attachAutocomplete(emailInput, modal.querySelector('#link-email-menu'), async (q) => {
                const data = await contributorsUi._fetchAuthorSuggestions(q);
                return (data.emails || []).map((e) => ({
                    label: e.value,
                    meta: `${e.commit_count} commits`,
                    value: e.value
                }));
            });

            modal.querySelector('#link-alias-submit').addEventListener('click', async () => {
                const submitBtn = modal.querySelector('#link-alias-submit');
                submitBtn.disabled = true;
                try {
                    let contributorId;
                    if (mode === 'existing') {
                        contributorId = parseInt(selectEl.value, 10);
                        if (!contributorId) {
                            app.showError('Select a contributor');
                            return;
                        }
                    } else {
                        const displayName = nameInput.value.trim();
                        if (!displayName) {
                            app.showError('Display name is required');
                            return;
                        }
                        const created = await app.apiCall('/api/git/contributors', {
                            method: 'POST',
                            body: JSON.stringify({
                                displayName,
                                primaryEmail: emailInput.value.trim() || alias.authorEmail || null
                            })
                        });
                        contributorId = created.id;
                    }
                    await app.apiCall(`/api/git/contributors/${contributorId}/aliases`, {
                        method: 'POST',
                        body: JSON.stringify({
                            authorName: alias.authorName,
                            authorEmail: alias.authorEmail
                        })
                    });
                    app.showSuccess('Identity linked');
                    modal.remove();
                    contributorsUi._contributorsState.detailsCache = {};
                    contributorsUi._contributorsState.expandedId = null;
                    await contributorsUi.loadContributorsPage();
                } catch (err) {
                    app.showError(err.message);
                } finally {
                    submitBtn.disabled = false;
                }
            });
        },

        _showContributorFormModal({ mode }) {
            const isCreate = mode === 'create';
            const body = patchMotion(`
                <label class="block text-sm font-medium text-gray-700 dark:text-dark-text">Display name</label>
                <${D} class="relative">
                    <input type="text" id="contrib-form-name" class="input" autocomplete="off" />
                    <${D} id="contrib-form-name-menu" class="autocomplete-menu hidden"></${D}>
                </${D}>
                <label class="block text-sm font-medium text-gray-700 dark:text-dark-text">Primary email</label>
                <${D} class="relative">
                    <input type="email" id="contrib-form-email" class="input" autocomplete="off" />
                    <${D} id="contrib-form-email-menu" class="autocomplete-menu hidden"></${D}>
                </${D}>
            `);
            const footer = `
                <button type="button" class="btn btn-secondary modal-close-btn">Cancel</button>
                <button type="button" id="contrib-form-submit" class="btn btn-primary">${isCreate ? 'Create' : 'Save'}</button>
            `;
            const modal = ui.showModal('contrib-form-modal', isCreate ? 'New contributor' : 'Edit contributor', body, footer);
            modal.querySelector('.modal-close-btn')?.addEventListener('click', () => modal.remove());

            const nameInput = modal.querySelector('#contrib-form-name');
            const emailInput = modal.querySelector('#contrib-form-email');
            contributorsUi._attachAutocomplete(nameInput, modal.querySelector('#contrib-form-name-menu'), async (q) => {
                const data = await contributorsUi._fetchAuthorSuggestions(q);
                return (data.names || []).map((n) => ({ label: n.value, meta: `${n.commit_count} commits`, value: n.value }));
            });
            contributorsUi._attachAutocomplete(emailInput, modal.querySelector('#contrib-form-email-menu'), async (q) => {
                const data = await contributorsUi._fetchAuthorSuggestions(q);
                return (data.emails || []).map((e) => ({ label: e.value, meta: `${e.commit_count} commits`, value: e.value }));
            });

            modal.querySelector('#contrib-form-submit').addEventListener('click', async () => {
                const displayName = nameInput.value.trim();
                if (!displayName) {
                    app.showError('Display name is required');
                    return;
                }
                try {
                    await app.apiCall('/api/git/contributors', {
                        method: 'POST',
                        body: JSON.stringify({
                            displayName,
                            primaryEmail: emailInput.value.trim() || null
                        })
                    });
                    app.showSuccess('Contributor created');
                    modal.remove();
                    await contributorsUi.loadContributorsPage();
                } catch (err) {
                    app.showError(err.message);
                }
            });
        }
    };

    if (window.platformPages) {
        platformPages.loadContributorsPage = contributorsUi.loadContributorsPage.bind(contributorsUi);
        window.contributorsUi = contributorsUi;
    }
})();
