// Tokens page module
// Depends on global `app` from /js/app.js

window.tokens = (function () {
  let initialized = false;

  const els = {
    form: () => document.getElementById('tokens-create-form'),
    name: () => document.getElementById('token-name'),
    expires: () => document.getElementById('token-expires'),
    list: () => document.getElementById('tokens-list'),
    count: () => document.getElementById('tokens-count'),
    newTokenBox: () => document.getElementById('new-token-box'),
    newTokenValue: () => document.getElementById('new-token-value'),
    copyBtn: () => document.getElementById('copy-new-token'),
  };

  function formatDate(d) {
    if (!d) return 'Never';
    try {
      const dt = new Date(d);
      if (isNaN(dt)) return '—';
      return dt.toLocaleString();
    } catch {
      return d;
    }
  }

  function toIsoIfProvided(v) {
    if (!v) return null;
    const dt = new Date(v);
    if (isNaN(dt)) return null;
    return dt.toISOString();
  }

  async function listTokens() {
    const data = await app.apiCall('/api/auth/tokens');
    renderTokens(data);
  }

  function renderTokens(tokens) {
    const list = els.list();
    const count = els.count();
    if (!list) return;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      list.innerHTML = '<p class="text-gray-600 dark:text-dark-text-secondary">No tokens yet. Create one above.</p>';
      if (count) count.textContent = '';
      return;
    }

    if (count) count.textContent = `${tokens.length} token${tokens.length === 1 ? '' : 's'}`;

    list.innerHTML = tokens
      .map(
        (t) => `
        <div class="commit-card">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-900 dark:text-dark-text">${escapeHtml(t.name || 'Untitled')}</div>
              <div class="text-xs text-gray-500 dark:text-dark-text-secondary">
                Created: ${formatDate(t.created_at)} • Expires: ${formatDate(t.expires_at)}
              </div>
            </div>
            <div class="flex items-center space-x-2">
              ${t.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-gray">Revoked</span>'}
              <button class="btn btn-secondary btn-sm" data-action="revoke" data-id="${t.id}" ${t.is_active ? '' : 'disabled'}>
                Revoke
              </button>
            </div>
          </div>
        </div>
      `
      )
      .join('');
  }

  function bindListActions() {
    const list = els.list();
    if (!list) return;
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action="revoke"]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      if (!confirm('Revoke this token? This action cannot be undone.')) return;
      try {
        btn.disabled = true;
        await app.apiCall(`/api/auth/tokens/${id}`, { method: 'DELETE' });
        app.showSuccess('Token revoked');
        await listTokens();
      } catch (err) {
        console.error('Revoke failed:', err);
        app.showError(err.message || 'Failed to revoke token');
        btn.disabled = false;
      }
    });
  }

  function bindCreateForm() {
    const form = els.form();
    if (!form) return;
    if (form.dataset.bound === 'true') return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (els.name().value || '').trim();
      const expiresRaw = els.expires().value;
      if (!name) {
        app.showError('Please enter a token name');
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      const prevText = submitBtn.textContent;
      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        const body = { name };
        const iso = toIsoIfProvided(expiresRaw);
        if (iso) body.expiresAt = iso;
        const created = await app.apiCall('/api/auth/tokens', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        els.name().value = '';
        els.expires().value = '';
        showNewToken(created.token);
        await listTokens();
      } catch (err) {
        console.error('Create token failed:', err);
        app.showError(err.message || 'Failed to create token');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = prevText;
      }
    });

    form.dataset.bound = 'true';
  }

  function showNewToken(tokenValue) {
    const box = els.newTokenBox();
    const valEl = els.newTokenValue();
    if (!box || !valEl) return;
    valEl.textContent = tokenValue || '';
    box.classList.remove('hidden');
    const copyBtn = els.copyBtn();
    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(tokenValue);
          app.showSuccess('Copied to clipboard');
        } catch {
          app.showError('Copy failed');
        }
      };
    }
    const closeBtn = box.querySelector('[data-dismiss]');
    if (closeBtn) {
      closeBtn.onclick = () => box.classList.add('hidden');
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadTokensPage() {
    if (!initialized) {
      bindCreateForm();
      bindListActions();
      initialized = true;
    }
    await listTokens();
  }

  return { loadTokensPage };
})();
