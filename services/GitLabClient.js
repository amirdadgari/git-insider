const Database = require('../config/database');
const ContributorService = require('./ContributorService');

class GitLabClient {
    constructor(db = null) {
        this.db = db || new Database();
        this.contributors = new ContributorService(this.db);
    }

    _isMaskedToken(token) {
        if (!token || typeof token !== 'string') return false;
        if (token === '********') return true;
        return token.length > 4 && /^\S{1,4}\*+$/.test(token);
    }

    async getIntegration() {
        return this.db.get(
            'SELECT id, base_url, private_token, enabled, last_sync_at, updated_at FROM gitlab_integration WHERE id = 1'
        );
    }

    async resolveIntegration(overrides = {}) {
        const stored = await this.getIntegration();
        const baseUrl = (overrides.baseUrl || overrides.base_url || stored?.base_url || '')
            .trim()
            .replace(/\/$/, '');
        let privateToken = overrides.privateToken ?? overrides.private_token;
        if (this._isMaskedToken(privateToken) || privateToken === '') {
            privateToken = undefined;
        }
        if (!privateToken) {
            privateToken = stored?.private_token;
        }
        const enabled =
            overrides.enabled !== undefined
                ? !!overrides.enabled
                : !!(stored?.enabled);
        if (!baseUrl || !privateToken) {
            throw new Error('GitLab base URL and private token are required');
        }
        return { base_url: baseUrl, private_token: privateToken, enabled };
    }

    async saveIntegration({ baseUrl, privateToken, enabled }) {
        const existing = await this.getIntegration();
        const masked =
            privateToken && privateToken.length > 4 && !this._isMaskedToken(privateToken)
                ? `${privateToken.slice(0, 4)}${'*'.repeat(Math.min(privateToken.length - 4, 20))}`
                : null;

        if (existing) {
            const params = [baseUrl];
            let sql = 'UPDATE gitlab_integration SET base_url = ?, updated_at = CURRENT_TIMESTAMP';
            if (privateToken && !this._isMaskedToken(privateToken)) {
                sql += ', private_token = ?';
                params.push(privateToken);
            }
            sql += ', enabled = ? WHERE id = 1';
            params.push(enabled ? 1 : 0);
            await this.db.run(sql, params);
        } else {
            if (!privateToken || this._isMaskedToken(privateToken)) {
                throw new Error('Private token is required when saving GitLab integration');
            }
            await this.db.run(
                'INSERT INTO gitlab_integration (id, base_url, private_token, enabled) VALUES (1, ?, ?, ?)',
                [baseUrl, privateToken, enabled ? 1 : 0]
            );
        }
        const row = await this.getIntegration();
        if (row && row.private_token) {
            row.private_token = masked || '********';
        }
        return row;
    }

    async _fetch(path, integration) {
        const base = integration.base_url.replace(/\/$/, '');
        const url = `${base}/api/v4${path}`;
        const res = await fetch(url, {
            headers: { 'PRIVATE-TOKEN': integration.private_token }
        });
        if (!res.ok) {
            const text = await res.text();
            let message = `GitLab API ${res.status}: ${text.slice(0, 200)}`;
            if (res.status === 401) {
                message = 'GitLab authentication failed — check your private token';
            } else if (res.status === 403) {
                message =
                    'GitLab access denied — sync requires an admin token with api scope (list users permission)';
            }
            throw new Error(message);
        }
        return res.json();
    }

    async testConnection(overrides = {}) {
        const integration = await this.resolveIntegration(overrides);
        const user = await this._fetch('/user', integration);
        return { ok: true, username: user.username, name: user.name, id: user.id };
    }

    async syncUsers(overrides = {}) {
        const integration = await this.resolveIntegration(overrides);
        if (!integration.enabled) {
            throw new Error('Enable GitLab integration (checkbox) before syncing users');
        }

        const hasOverrides =
            overrides.baseUrl !== undefined ||
            overrides.base_url !== undefined ||
            overrides.privateToken !== undefined ||
            overrides.private_token !== undefined ||
            overrides.enabled !== undefined;

        if (hasOverrides) {
            await this.saveIntegration({
                baseUrl: integration.base_url,
                privateToken: integration.private_token,
                enabled: integration.enabled
            });
        }

        let page = 1;
        let total = 0;
        const perPage = 100;

        while (true) {
            const users = await this._fetch(
                `/users?per_page=${perPage}&page=${page}&without_project_bots=true`,
                integration
            );
            if (!Array.isArray(users) || users.length === 0) break;

            for (const u of users) {
                const existing = await this.db.get('SELECT id FROM gitlab_users WHERE gitlab_id = ?', [
                    u.id
                ]);
                if (existing) {
                    await this.db.run(
                        `UPDATE gitlab_users SET username = ?, name = ?, email = ?, avatar_url = ?, synced_at = CURRENT_TIMESTAMP WHERE gitlab_id = ?`,
                        [u.username, u.name, u.public_email || u.email || null, u.avatar_url, u.id]
                    );
                } else {
                    await this.db.run(
                        `INSERT INTO gitlab_users (gitlab_id, username, name, email, avatar_url) VALUES (?, ?, ?, ?, ?)`,
                        [u.id, u.username, u.name, u.public_email || u.email || null, u.avatar_url]
                    );
                }
                total++;
            }

            if (users.length < perPage) break;
            page++;
        }

        await this.db.run(
            'UPDATE gitlab_integration SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        );

        await this.autoLinkContributors();
        return { synced: total };
    }

    async autoLinkContributors() {
        const aliases = await this.db.all(`
            SELECT DISTINCT author_name, author_email FROM commits WHERE contributor_id IS NULL
        `);
        for (const a of aliases) {
            await this.contributors.ensureAliasFromCommit(a.author_name, a.author_email);
        }
    }

    async listCachedUsers() {
        return this.db.all(
            'SELECT gitlab_id, username, name, email, avatar_url, synced_at FROM gitlab_users ORDER BY username'
        );
    }

    async getProjectByPath(fullpath) {
        const integration = await this.getIntegration();
        if (!integration || !integration.enabled || !integration.base_url || !integration.private_token) {
            return null;
        }
        const encoded = encodeURIComponent(fullpath);
        try {
            return await this._fetch(`/projects/${encoded}`, integration);
        } catch {
            return null;
        }
    }
}

module.exports = GitLabClient;
