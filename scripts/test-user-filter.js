/**
 * Quick sanity check for lib/userFilter.js
 * Run: node scripts/test-user-filter.js
 */
const assert = require('assert');
const {
    parseUserFilter,
    resolveUserFilter,
    likeContains,
    toGitAuthorPattern,
    normalizeRangeDates
} = require('../lib/userFilter');

const multi = parseUserFilter({ users: ['alice@co.com', 'bob'] });
assert.deepStrictEqual(multi.identifiers, ['alice@co.com', 'bob']);
assert.strictEqual(multi.gitAuthorPattern, 'alice@co\\.com|bob');

const comma = parseUserFilter({ users: 'alice,bob' });
assert.deepStrictEqual(comma.identifiers, ['alice', 'bob']);

const legacy = resolveUserFilter({ userPattern: 'alice|bob' });
assert.deepStrictEqual(legacy.identifiers, ['alice', 'bob']);

assert.strictEqual(likeContains('a_b%'), '%a\\_b\\%%');

const range = normalizeRangeDates('2026-05-01', '2026-05-21');
assert.ok(range.startDate);
assert.ok(range.endDate);
assert.ok(new Date(range.startDate) <= new Date(range.endDate));

console.log('userFilter: all checks passed');
