let cron;
try {
    cron = require('node-cron');
} catch {
    cron = null;
}
const Database = require('../config/database');
const SettingsService = require('./SettingsService');
const CommitIndexer = require('./CommitIndexer');

class Scheduler {
    constructor(gitService) {
        this.gitService = gitService;
        this.db = gitService.db;
        this.settings = new SettingsService(this.db);
        this.indexer = new CommitIndexer(this.db, gitService);
        this.workspaceTask = null;
        this.evictionTask = null;
    }

    async start() {
        if (!cron) {
            console.warn('[scheduler] node-cron not installed; using setInterval fallback');
            this._startIntervalFallback();
            return;
        }
        await this._scheduleWorkspaceScan();
        this.evictionTask = cron.schedule('0 3 * * *', async () => {
            try {
                const result = await this.indexer.runEviction();
                console.log('[scheduler] Eviction completed:', result);
            } catch (e) {
                console.error('[scheduler] Eviction failed:', e.message);
            }
        });
        console.log('[scheduler] Started (workspace scan + daily eviction)');
    }

    _startIntervalFallback() {
        const run = async () => {
            const minutes = await this.settings.getScanIntervalMinutes();
            this._intervalMs = Math.max(5, minutes) * 60 * 1000;
            await this.runWorkspaceScan();
            this._intervalHandle = setInterval(() => this.runWorkspaceScan(), this._intervalMs);
        };
        run().catch(console.error);
        setInterval(async () => {
            try {
                await this.indexer.runEviction();
            } catch (e) {
                console.error('[scheduler] Eviction failed:', e.message);
            }
        }, 24 * 60 * 60 * 1000);
    }

    async _scheduleWorkspaceScan() {
        if (this.workspaceTask) {
            this.workspaceTask.stop();
        }

        const minutes = await this.settings.getScanIntervalMinutes();
        const cronExpr = `*/${Math.max(1, Math.min(minutes, 59))} * * * *`;

        this.workspaceTask = cron.schedule(cronExpr, () => this.runWorkspaceScan());
    }

    async reschedule() {
        if (!cron) return;
        await this._scheduleWorkspaceScan();
    }

    async runWorkspaceScan() {
        try {
            const workspaces = await this.db.all('SELECT * FROM workspaces WHERE is_active = 1');
            for (const ws of workspaces) {
                try {
                    await this.gitService.scanWorkspace(ws.root_path, {});
                    await this.indexer.indexWorkspace(ws.id);
                } catch (e) {
                    console.warn(`[scheduler] Workspace scan failed for ${ws.root_path}:`, e.message);
                }
            }
            await this.db.run(
                'UPDATE scheduler_status SET last_workspace_scan_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
            ).catch(async () => {
                await this.db.run(
                    'INSERT INTO scheduler_status (id, last_workspace_scan_at) VALUES (1, CURRENT_TIMESTAMP)'
                );
            });
            console.log(`[scheduler] Scanned ${workspaces.length} workspace(s)`);
        } catch (e) {
            await this.db.run(
                'UPDATE scheduler_status SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
                [e.message]
            ).catch(() => {});
            console.error('[scheduler] Workspace scan error:', e.message);
        }
    }

    stop() {
        if (this.workspaceTask) this.workspaceTask.stop();
        if (this.evictionTask) this.evictionTask.stop();
        if (this._intervalHandle) clearInterval(this._intervalHandle);
    }
}

module.exports = Scheduler;
