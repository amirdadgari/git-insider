const Database = require('../config/database');

class ContributorService {
    constructor(db = null) {
        this.db = db || new Database();
    }

    async listContributors() {
        return this.db.all(`
            SELECT c.*,
                (SELECT COUNT(*) FROM contributor_aliases a WHERE a.contributor_id = c.id) AS alias_count
            FROM contributors c
            ORDER BY c.display_name
        `);
    }

    async getContributor(id) {
        const contributor = await this.db.get('SELECT * FROM contributors WHERE id = ?', [id]);
        if (!contributor) return null;
        const aliases = await this.db.all(
            'SELECT * FROM contributor_aliases WHERE contributor_id = ?',
            [id]
        );
        return { ...contributor, aliases };
    }

    async createContributor({ displayName, primaryEmail, gitlabUserId }) {
        const result = await this.db.run(
            'INSERT INTO contributors (display_name, primary_email, gitlab_user_id) VALUES (?, ?, ?)',
            [displayName, primaryEmail || null, gitlabUserId || null]
        );
        return this.getContributor(result.id);
    }

    async updateContributor(id, { displayName, primaryEmail, gitlabUserId }) {
        await this.db.run(
            `UPDATE contributors SET
                display_name = COALESCE(?, display_name),
                primary_email = COALESCE(?, primary_email),
                gitlab_user_id = COALESCE(?, gitlab_user_id),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [displayName, primaryEmail, gitlabUserId, id]
        );
        return this.getContributor(id);
    }

    async linkAlias(contributorId, authorName, authorEmail) {
        const existing = await this.db.get(
            'SELECT id, contributor_id FROM contributor_aliases WHERE author_email = ? AND author_name = ?',
            [authorEmail || '', authorName || '']
        );
        if (existing) {
            await this.db.run('UPDATE contributor_aliases SET contributor_id = ? WHERE id = ?', [
                contributorId,
                existing.id
            ]);
        } else {
            await this.db.run(
                'INSERT INTO contributor_aliases (contributor_id, author_name, author_email) VALUES (?, ?, ?)',
                [contributorId, authorName || null, authorEmail || null]
            );
        }
        await this.db.run(
            'UPDATE commits SET contributor_id = ? WHERE author_name = ? AND author_email = ?',
            [contributorId, authorName || null, authorEmail || null]
        );
        return { contributorId, authorName, authorEmail };
    }

    async mergeContributors(targetId, sourceIds) {
        for (const sid of sourceIds) {
            if (sid === targetId) continue;
            await this.db.run('UPDATE contributor_aliases SET contributor_id = ? WHERE contributor_id = ?', [
                targetId,
                sid
            ]);
            await this.db.run('UPDATE commits SET contributor_id = ? WHERE contributor_id = ?', [
                targetId,
                sid
            ]);
            await this.db.run('DELETE FROM contributors WHERE id = ?', [sid]);
        }
        return this.getContributor(targetId);
    }

    async listUnmappedAliases(limit = 100) {
        return this.db.all(`
            SELECT DISTINCT c.author_name, c.author_email, COUNT(*) AS commit_count
            FROM commits c
            LEFT JOIN contributor_aliases a
                ON c.author_name = a.author_name AND c.author_email = a.author_email
            WHERE c.contributor_id IS NULL
                AND a.id IS NULL
                AND (c.author_name IS NOT NULL OR c.author_email IS NOT NULL)
            GROUP BY c.author_name, c.author_email
            ORDER BY commit_count DESC
            LIMIT ?
        `, [limit]);
    }

    async searchAuthorIdentities(query = '', limit = 15) {
        const trimmed = String(query || '').trim();
        const cap = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);
        const like = `%${trimmed}%`;

        const nameWhere = trimmed
            ? 'WHERE author_name IS NOT NULL AND author_name != \'\' AND author_name LIKE ?'
            : 'WHERE author_name IS NOT NULL AND author_name != \'\'';
        const emailWhere = trimmed
            ? 'WHERE author_email IS NOT NULL AND author_email != \'\' AND author_email LIKE ?'
            : 'WHERE author_email IS NOT NULL AND author_email != \'\'';
        const identityWhere = trimmed
            ? 'WHERE (author_name LIKE ? OR author_email LIKE ?)'
            : 'WHERE author_name IS NOT NULL OR author_email IS NOT NULL';

        const [names, emails, identities] = await Promise.all([
            this.db.all(`
                SELECT author_name AS value, COUNT(*) AS commit_count
                FROM commits
                ${nameWhere}
                GROUP BY author_name
                ORDER BY commit_count DESC
                LIMIT ?
            `, trimmed ? [like, cap] : [cap]),
            this.db.all(`
                SELECT author_email AS value, COUNT(*) AS commit_count
                FROM commits
                ${emailWhere}
                GROUP BY author_email
                ORDER BY commit_count DESC
                LIMIT ?
            `, trimmed ? [like, cap] : [cap]),
            this.db.all(`
                SELECT author_name, author_email, COUNT(*) AS commit_count
                FROM commits
                ${identityWhere}
                GROUP BY author_name, author_email
                ORDER BY commit_count DESC
                LIMIT ?
            `, trimmed ? [like, like, cap] : [cap])
        ]);

        return { names, emails, identities };
    }

    async resolveContributorId(authorName, authorEmail) {
        const alias = await this.db.get(
            'SELECT contributor_id FROM contributor_aliases WHERE author_name = ? AND author_email = ?',
            [authorName || '', authorEmail || '']
        );
        return alias ? alias.contributor_id : null;
    }

    async ensureAliasFromCommit(authorName, authorEmail) {
        let contributorId = await this.resolveContributorId(authorName, authorEmail);
        if (contributorId) return contributorId;

        if (authorEmail) {
            const gitlab = await this.db.get('SELECT gitlab_id FROM gitlab_users WHERE email = ?', [authorEmail]);
            if (gitlab) {
                const existing = await this.db.get(
                    'SELECT id FROM contributors WHERE gitlab_user_id = ?',
                    [gitlab.gitlab_id]
                );
                if (existing) {
                    contributorId = existing.id;
                } else {
                    const gu = await this.db.get('SELECT * FROM gitlab_users WHERE gitlab_id = ?', [gitlab.gitlab_id]);
                    const ins = await this.db.run(
                        'INSERT INTO contributors (display_name, primary_email, gitlab_user_id) VALUES (?, ?, ?)',
                        [gu.name || gu.username, gu.email, gu.gitlab_id]
                    );
                    contributorId = ins.id;
                }
                await this.linkAlias(contributorId, authorName, authorEmail);
                return contributorId;
            }
        }
        return null;
    }
}

module.exports = ContributorService;
