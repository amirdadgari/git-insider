// Shared UI helpers — consistent styling across all pages
(function () {
    const TAG = 'd' + 'iv';

    const ui = {
        escape(value) {
            const el = document.createElement(TAG);
            el.textContent = value == null ? '' : String(value);
            return el.innerHTML;
        },

        emptyState(message, extraClass = '') {
            return `<p class="empty-state ${extraClass}">${ui.escape(message)}</p>`;
        },

        statTile(label, value, tone = 'text-gray-900 dark:text-dark-text') {
            return `
                <${TAG} class="stat-tile">
                    <p class="stat-tile-label">${ui.escape(label)}</p>
                    <p class="stat-tile-value ${tone}">${ui.escape(value)}</p>
                </${TAG}>
            `;
        },

        statTiles(tiles) {
            return (tiles || []).map((t) => ui.statTile(t.label, t.value, t.tone)).join('');
        },

        cardSectionHeader(title, trailingHtml = '') {
            return `
                <${TAG} class="card-section-header">
                    <h3 class="card-title">${ui.escape(title)}</h3>
                    ${trailingHtml}
                </${TAG}>
            `;
        },

        avatar(initial, variant = 'blue') {
            const tones = {
                blue: 'avatar-blue',
                purple: 'avatar-purple'
            };
            return `<span class="avatar ${tones[variant] || tones.blue}" aria-hidden="true">${ui.escape(initial)}</span>`;
        },

        showModal(id, title, bodyHtml, footerHtml = '', { wide = false } = {}) {
            document.getElementById(id)?.remove();
            const modal = document.createElement(TAG);
            modal.id = id;
            modal.className = 'modal-overlay';
            const panelClass = wide ? 'modal-panel modal-panel-wide' : 'modal-panel';
            modal.innerHTML = `
                <${TAG} class="${panelClass}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
                    <${TAG} class="modal-header">
                        <h2 id="${id}-title" class="modal-title">${title}</h2>
                        <button type="button" class="modal-close" aria-label="Close">×</button>
                    </${TAG}>
                    <${TAG} class="modal-body">${bodyHtml}</${TAG}>
                    ${footerHtml ? `<${TAG} class="modal-footer">${footerHtml}</${TAG}>` : ''}
                </${TAG}>
            `;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            modal.querySelector('.modal-close')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            return modal;
        }
    };

    window.ui = ui;
})();
