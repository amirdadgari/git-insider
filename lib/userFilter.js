const moment = require('moment');

/**
 * Split a user list from a string (comma or pipe) or array.
 * @param {string|string[]|null|undefined} raw
 * @returns {string[]}
 */
function splitUserList(raw) {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) {
        return raw.flatMap((entry) => splitUserList(entry));
    }
    return String(raw)
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Deduplicate identifiers (case-sensitive; emails/usernames are distinct by case in git).
 * @param {string[]} list
 * @returns {string[]}
 */
function dedupeIdentifiers(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const key = item;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

/**
 * Escape % and _ for SQL LIKE with ESCAPE '\\'.
 * @param {string} value
 * @returns {string}
 */
function escapeLikePattern(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/[%_]/g, (m) => `\\${m}`);
}

/**
 * Build a case-sensitive SQL LIKE pattern that contains `value`.
 * @param {string} value
 * @returns {string}
 */
function likeContains(value) {
    return `%${escapeLikePattern(value)}%`;
}

/**
 * Escape special characters for git log --author and RegExp author checks.
 * @param {string} value
 * @returns {string}
 */
function escapeGitAuthorRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Git author filter: OR of identifiers (regex for --author / in-memory match).
 * @param {string[]} identifiers
 * @returns {string|null}
 */
function toGitAuthorPattern(identifiers) {
    if (!identifiers.length) return null;
    return identifiers.map(escapeGitAuthorRegex).join('|');
}

/**
 * Parse user / users from GraphQL or REST into identifiers + git pattern.
 * @param {{ user?: string, users?: string|string[] }} input
 * @returns {{ identifiers: string[], gitAuthorPattern: string|null }}
 */
function parseUserFilter(input = {}) {
    const list = [];
    if (input.user) {
        list.push(...splitUserList(input.user));
    }
    if (input.users != null) {
        list.push(...splitUserList(input.users));
    }
    const identifiers = dedupeIdentifiers(list);
    return {
        identifiers,
        gitAuthorPattern: toGitAuthorPattern(identifiers)
    };
}

/**
 * Resolve user filter from query options (supports legacy userPattern string).
 * @param {{ user?: string, users?: string|string[], userPattern?: string, userIdentifiers?: string[] }} options
 * @returns {{ identifiers: string[], gitAuthorPattern: string|null }}
 */
function resolveUserFilter(options = {}) {
    if (Array.isArray(options.userIdentifiers) && options.userIdentifiers.length) {
        const identifiers = dedupeIdentifiers(options.userIdentifiers.map((s) => String(s).trim()).filter(Boolean));
        return {
            identifiers,
            gitAuthorPattern: toGitAuthorPattern(identifiers)
        };
    }
    if (options.userPattern) {
        const identifiers = dedupeIdentifiers(splitUserList(options.userPattern));
        return {
            identifiers,
            gitAuthorPattern: toGitAuthorPattern(identifiers)
        };
    }
    return parseUserFilter({ user: options.user, users: options.users });
}

/**
 * Inclusive date range for indexed commit queries.
 * @param {string|null|undefined} startDate
 * @param {string|null|undefined} endDate
 * @returns {{ startDate: string|null, endDate: string|null }}
 */
function normalizeRangeDates(startDate, endDate) {
    return {
        startDate: startDate ? moment(startDate).startOf('day').toISOString() : null,
        endDate: endDate ? moment(endDate).endOf('day').toISOString() : null
    };
}

module.exports = {
    splitUserList,
    dedupeIdentifiers,
    escapeLikePattern,
    likeContains,
    escapeGitAuthorRegex,
    toGitAuthorPattern,
    parseUserFilter,
    resolveUserFilter,
    normalizeRangeDates
};
