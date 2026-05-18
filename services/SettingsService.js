const Database = require('../config/database');

const DEFAULTS = {
    index_window_months: '3',
    retention_idle_days: '7',
    workspace_scan_interval_minutes: '30'
};

class SettingsService {
    constructor(db = null) {
        this.db = db || new Database();
    }

    async get(key) {
        const row = await this.db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
        return row ? row.value : DEFAULTS[key];
    }

    async getNumber(key, fallback) {
        const v = await this.get(key);
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? fallback : n;
    }

    async getAll() {
        const rows = await this.db.all('SELECT key, value, updated_at FROM app_settings ORDER BY key');
        const map = { ...DEFAULTS };
        for (const r of rows) {
            map[r.key] = r.value;
        }
        return map;
    }

    async setMany(updates) {
        for (const [key, value] of Object.entries(updates)) {
            if (value === undefined) continue;
            const existing = await this.db.get('SELECT key FROM app_settings WHERE key = ?', [key]);
            if (existing) {
                await this.db.run(
                    'UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
                    [String(value), key]
                );
            } else {
                await this.db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', [key, String(value)]);
            }
        }
        return this.getAll();
    }

    async getIndexWindowMonths() {
        return this.getNumber('index_window_months', 3);
    }

    async getRetentionIdleDays() {
        return this.getNumber('retention_idle_days', 7);
    }

    async getScanIntervalMinutes() {
        return this.getNumber('workspace_scan_interval_minutes', 30);
    }
}

module.exports = SettingsService;
