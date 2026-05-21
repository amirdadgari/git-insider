/**
 * Lightweight step timer for commit/analytics queries.
 * Enabled by default; set COMMITS_QUERY_TIMING=false to disable.
 */
function isCommitsQueryTimingEnabled() {
    const v = process.env.COMMITS_QUERY_TIMING;
    if (v === '0' || v === 'false' || v === 'off') return false;
    return true;
}

function createQueryTimer(label) {
    const enabled = isCommitsQueryTimingEnabled();
    const startedAt = Date.now();
    const steps = [];

    return {
        mark(step, extra = null) {
            if (!enabled) return;
            const entry = { step, ms: Date.now() - startedAt };
            if (extra != null) entry.extra = extra;
            steps.push(entry);
        },
        finish(summary = {}) {
            if (!enabled) return;
            const totalMs = Date.now() - startedAt;
            console.log(
                `[commits-query] ${label} total=${totalMs}ms`,
                JSON.stringify({ ...summary, steps })
            );
        }
    };
}

module.exports = { createQueryTimer, isCommitsQueryTimingEnabled };
