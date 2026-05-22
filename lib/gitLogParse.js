/**
 * Parse a git log --pretty=format:%H|%an|%ae|%date|%s line (message may contain |).
 * @param {string} line
 * @returns {{ hash: string, author: string, email: string, date: string, message: string }|null}
 */
function parseCommitLogLine(line) {
    if (!line || !line.includes('|') || /^\d+\s+\d+\s+/.test(line)) return null;
    const parts = line.split('|');
    if (parts.length < 5) return null;
    const [hash, author, email, date, ...rest] = parts;
    return {
        hash,
        author,
        email,
        date,
        message: rest.join('|')
    };
}

module.exports = { parseCommitLogLine };
