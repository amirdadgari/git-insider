/**
 * In-memory indexing job progress (singleton) for UI + WebSocket broadcast.
 */
const { EventEmitter } = require('events');

const events = new EventEmitter();
events.setMaxListeners(50);

const state = {
    active: false,
    phase: 'idle',
    startedAt: null,
    finishedAt: null,
    reposTotal: 0,
    reposCompleted: 0,
    currentRepository: null,
    currentRepositoryId: null,
    commitsIndexed: 0,
    commitsSkipped: 0,
    batchesInCurrentRepo: 0,
    message: '',
    percent: 0,
    error: null
};

function snapshot() {
    return {
        active: state.active,
        phase: state.phase,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        reposTotal: state.reposTotal,
        reposCompleted: state.reposCompleted,
        currentRepository: state.currentRepository,
        commitsIndexed: state.commitsIndexed,
        commitsSkipped: state.commitsSkipped,
        message: state.message,
        percent: state.percent,
        error: state.error
    };
}

function _emit() {
    events.emit('update', snapshot());
}

function _recalcPercent() {
    if (!state.active || !state.reposTotal) {
        state.percent = state.active ? 0 : (state.phase === 'complete' ? 100 : 0);
        return;
    }
    const repoWeight = 100 / state.reposTotal;
    const base = state.reposCompleted * repoWeight;
    const inRepo = state.batchesInCurrentRepo > 0
        ? Math.min(repoWeight * 0.85, repoWeight * 0.85 * (1 - 1 / (1 + state.batchesInCurrentRepo * 0.15)))
        : 0;
    state.percent = Math.min(99, Math.round(base + inRepo));
}

function addRepos(count) {
    state.reposTotal += count || 0;
    _recalcPercent();
    _emit();
}

function start({ reposTotal, message }) {
    state.active = true;
    state.phase = 'indexing';
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    state.reposTotal = reposTotal || 0;
    state.reposCompleted = 0;
    state.currentRepository = null;
    state.currentRepositoryId = null;
    state.commitsIndexed = 0;
    state.commitsSkipped = 0;
    state.batchesInCurrentRepo = 0;
    state.message = message || 'Starting index…';
    state.percent = 0;
    state.error = null;
    _recalcPercent();
    _emit();
}

function setRepository(repoId, repoName, repoIndex) {
    state.currentRepositoryId = repoId;
    state.currentRepository = repoName || `Repository ${repoId}`;
    state.batchesInCurrentRepo = 0;
    state.message = `Indexing ${state.currentRepository} (${repoIndex + 1}/${state.reposTotal})…`;
    _recalcPercent();
    _emit();
}

function completeRepository() {
    state.reposCompleted += 1;
    state.batchesInCurrentRepo = 0;
    _recalcPercent();
    _emit();
}

function recordBatch({ indexed, skipped, oldestDate }) {
    state.commitsIndexed += indexed || 0;
    state.commitsSkipped += skipped || 0;
    state.batchesInCurrentRepo += 1;
    if (oldestDate) {
        state.message = `Indexing ${state.currentRepository || 'repository'} — through ${oldestDate.slice(0, 10)}`;
    }
    _recalcPercent();
    _emit();
}

function complete(message) {
    state.active = false;
    state.phase = 'complete';
    state.finishedAt = new Date().toISOString();
    state.percent = 100;
    state.message = message || `Indexed ${state.commitsIndexed} commits`;
    state.currentRepository = null;
    _emit();
}

function fail(error) {
    state.active = false;
    state.phase = 'error';
    state.finishedAt = new Date().toISOString();
    state.error = error?.message || String(error);
    state.message = `Indexing failed: ${state.error}`;
    _emit();
}

function isActive() {
    return state.active;
}

module.exports = {
    snapshot,
    events,
    start,
    addRepos,
    setRepository,
    completeRepository,
    recordBatch,
    complete,
    fail,
    isActive
};
