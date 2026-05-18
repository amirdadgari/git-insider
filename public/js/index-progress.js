/**
 * Indexing progress in the top toolbar: WebSocket push with 10s polling fallback.
 * Status text is shown only in the hover popover; toolbar shows spinner + ring only.
 */
const indexProgressPoller = {
    ws: null,
    pollIntervalId: null,
    hideTimeoutId: null,
    reconnectTimeoutId: null,
    useWebSocket: true,
    pollMs: 10000,
    ringCircumference: 2 * Math.PI * 15,

    start() {
        this.stop();
        this.applyStatus(this._idleStatus());
        this.connectWebSocket();
        this.poll();
        this.pollIntervalId = setInterval(() => this.poll(), this.pollMs);
    },

    stop() {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }
        if (this.hideTimeoutId) {
            clearTimeout(this.hideTimeoutId);
            this.hideTimeoutId = null;
        }
        this.closeWebSocket();
        this.hideWidget();
    },

    _idleStatus() {
        return { active: false, phase: 'idle', percent: 0, message: '' };
    },

    _wsUrl() {
        const token = localStorage.getItem('authToken');
        const apiKey = localStorage.getItem('activeApiKey');
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams();
        if (token) params.set('token', token);
        else if (apiKey) params.set('apiKey', apiKey);
        return `${proto}//${window.location.host}/ws/index-progress?${params}`;
    },

    connectWebSocket() {
        if (!this.useWebSocket || !window.WebSocket) return;
        const token = localStorage.getItem('authToken');
        const apiKey = localStorage.getItem('activeApiKey');
        if (!token && !apiKey) return;

        try {
            this.ws = new WebSocket(this._wsUrl());

            this.ws.onopen = () => {
                this.useWebSocket = true;
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'status' && msg.data) {
                        this.applyStatus(msg.data);
                    }
                } catch (_) {}
            };

            this.ws.onclose = () => {
                this.ws = null;
                if (localStorage.getItem('authToken') || localStorage.getItem('activeApiKey')) {
                    this.useWebSocket = false;
                    this.reconnectTimeoutId = setTimeout(() => {
                        this.useWebSocket = true;
                        this.connectWebSocket();
                    }, 15000);
                }
            };

            this.ws.onerror = () => {
                this.useWebSocket = false;
            };
        } catch (_) {
            this.useWebSocket = false;
        }
    },

    closeWebSocket() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
    },

    async poll() {
        if (!localStorage.getItem('authToken') && !localStorage.getItem('activeApiKey')) {
            this.hideWidget();
            return;
        }

        if (this.useWebSocket && this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const status = await app.apiCall('/api/git/index/status');
            this.applyStatus(status);
        } catch (_) {}
    },

    applyStatus(status) {
        const widget = document.getElementById('index-toolbar-status');
        const tooltip = document.getElementById('index-toolbar-tooltip');
        const fill = document.getElementById('index-toolbar-fill');
        const ring = document.getElementById('index-toolbar-ring');
        const spinner = widget?.querySelector('.loading-spinner');
        if (!widget || !tooltip || !fill || !ring) return;

        const show = status.active || status.phase === 'indexing';
        const percent = Math.max(0, Math.min(100, status.percent || 0));

        if (show) {
            if (this.hideTimeoutId) {
                clearTimeout(this.hideTimeoutId);
                this.hideTimeoutId = null;
            }
            widget.classList.remove('hidden');
            ring.classList.remove('stroke-red-500', 'stroke-green-500');
            ring.classList.add('stroke-git-blue');
            if (spinner) spinner.classList.remove('hidden');

            const offset = this.ringCircumference * (1 - percent / 100);
            ring.setAttribute('stroke-dashoffset', String(offset));

            fill.style.width = `${percent}%`;
            fill.classList.remove('bg-red-500', 'bg-green-500');
            fill.classList.add('bg-git-blue');

            const repoPart = status.reposTotal
                ? `Repo ${Math.min(status.reposCompleted + 1, status.reposTotal)}/${status.reposTotal}`
                : '';
            tooltip.textContent = [
                status.message || 'Indexing commits (newest first)…',
                repoPart,
                `${status.commitsIndexed || 0} new commits`,
                `${percent}%`
            ].filter(Boolean).join(' · ');

            widget.setAttribute('aria-label', `Indexing ${percent}%`);
            return;
        }

        if (status.phase === 'complete') {
            widget.classList.remove('hidden');
            if (spinner) spinner.classList.add('hidden');
            ring.classList.remove('stroke-git-blue');
            ring.classList.add('stroke-green-500');
            ring.setAttribute('stroke-dashoffset', '0');
            fill.style.width = '100%';
            fill.classList.remove('bg-git-blue');
            fill.classList.add('bg-green-500');
            tooltip.textContent = status.message || 'Indexing complete';
            widget.setAttribute('aria-label', 'Indexing complete');

            this.hideTimeoutId = setTimeout(() => this.hideWidget(), 4000);
            return;
        }

        if (status.phase === 'error') {
            widget.classList.remove('hidden');
            if (spinner) spinner.classList.add('hidden');
            ring.classList.remove('stroke-git-blue');
            ring.classList.add('stroke-red-500');
            ring.setAttribute('stroke-dashoffset', '0');
            fill.style.width = '100%';
            fill.classList.remove('bg-git-blue');
            fill.classList.add('bg-red-500');
            tooltip.textContent = status.message || 'Indexing failed';

            this.hideTimeoutId = setTimeout(() => this.hideWidget(), 6000);
            return;
        }

        this.hideWidget();
    },

    hideWidget() {
        const widget = document.getElementById('index-toolbar-status');
        const ring = document.getElementById('index-toolbar-ring');
        const fill = document.getElementById('index-toolbar-fill');
        const spinner = widget?.querySelector('.loading-spinner');
        if (widget) widget.classList.add('hidden');
        if (ring) {
            ring.setAttribute('stroke-dashoffset', String(this.ringCircumference));
            ring.classList.remove('stroke-red-500', 'stroke-green-500');
            ring.classList.add('stroke-git-blue');
        }
        if (fill) {
            fill.style.width = '0%';
            fill.classList.remove('bg-red-500', 'bg-green-500');
            fill.classList.add('bg-git-blue');
        }
        if (spinner) spinner.classList.remove('hidden');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('authToken') || localStorage.getItem('activeApiKey')) {
        indexProgressPoller.start();
    }
});
