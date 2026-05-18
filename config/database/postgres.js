const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class PostgresDatabase {
    constructor() {
        this.dialect = 'postgres';
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 20
        });
    }

    adaptSql(sql) {
        let s = sql;
        s = s.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
        if (/INSERT OR IGNORE/i.test(sql)) {
            s = s.replace(/;\s*$/, '');
            if (!/ON CONFLICT/i.test(s)) {
                const tableMatch = s.match(/INSERT INTO\s+(\w+)/i);
                if (tableMatch) {
                    const table = tableMatch[1];
                    if (table === 'app_settings') s += ' ON CONFLICT (key) DO NOTHING';
                    else if (table === 'scheduler_status') s += ' ON CONFLICT (id) DO NOTHING';
                }
            }
        }
        s = s.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
        s = s.replace(/AUTOINCREMENT/gi, '');
        s = s.replace(/DATETIME/gi, 'TIMESTAMPTZ');
        s = s.replace(/BOOLEAN DEFAULT 1/gi, 'BOOLEAN DEFAULT TRUE');
        s = s.replace(/is_active BOOLEAN DEFAULT 1/gi, 'is_active BOOLEAN DEFAULT TRUE');
        return s;
    }

    likeOp() {
        return 'ILIKE';
    }

    nowFn() {
        return 'CURRENT_TIMESTAMP';
    }

    _toPg(sql, params) {
        if (/\$\d+/.test(sql)) {
            return { text: sql, values: params };
        }
        let i = 0;
        const text = sql.replace(/\?/g, () => `$${++i}`);
        return { text, values: params };
    }

    async connect() {
        const client = await this.pool.connect();
        try {
            await client.query('SELECT 1');
            console.log('Connected to PostgreSQL database');
        } finally {
            client.release();
        }
        await this.initializeSchema();
    }

    async initializeSchema() {
        const schemas = [
            `CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                role TEXT DEFAULT 'user',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS api_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token TEXT UNIQUE NOT NULL,
                name TEXT,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            )`,
            `CREATE TABLE IF NOT EXISTS git_repositories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                url TEXT,
                description TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS workspaces (
                id SERIAL PRIMARY KEY,
                root_path TEXT UNIQUE NOT NULL,
                name TEXT,
                repo_count INTEGER DEFAULT 0,
                last_scanned_at TIMESTAMPTZ,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS user_repository_permissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                repository_id INTEGER NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
                permission TEXT DEFAULT 'read',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, repository_id)
            )`,
            `CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const schema of schemas) {
            await this.run(schema);
        }

        await this.migrateLegacyColumns();
        await this.createDefaultAdmin();

        const { runMigrations } = require('./migrate');
        await runMigrations(this);
    }

    async migrateLegacyColumns() {
        const cols = [
            ['display_name', 'TEXT'],
            ['scm', 'TEXT'],
            ['scm_fullpath', 'TEXT'],
            ['folder_name', 'TEXT'],
            ['gitlab_project_id', 'INTEGER'],
            ['display_name_custom', 'INTEGER DEFAULT 0']
        ];
        for (const [col, type] of cols) {
            await this.run(
                `ALTER TABLE git_repositories ADD COLUMN IF NOT EXISTS ${col} ${type}`
            ).catch(() => {});
        }
    }

    async createDefaultAdmin() {
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

        try {
            const existingAdmin = await this.get('SELECT * FROM users WHERE username = $1', [adminUsername]);
            if (!existingAdmin) {
                const hashedPassword = await bcrypt.hash(adminPassword, 10);
                await this.run(
                    'INSERT INTO users (username, password, email, role) VALUES ($1, $2, $3, $4)',
                    [adminUsername, hashedPassword, `${adminUsername}@gitinsider.app`, 'admin']
                );
                console.log(`Default admin user created: ${adminUsername}`);
            }
        } catch (error) {
            console.error('Error creating default admin:', error);
        }
    }

    async exec(sql) {
        const adapted = this.adaptSql(sql);
        await this.pool.query(adapted);
    }

    async run(sql, params = []) {
        const adapted = this.adaptSql(sql);
        let { text, values } = this._toPg(adapted, params);
        if (/^\s*INSERT/i.test(text) && !/RETURNING/i.test(text)) {
            text = `${text} RETURNING id`;
        }
        const result = await this.pool.query(text, values);
        const id = result.rows[0]?.id ?? null;
        return { id, changes: result.rowCount };
    }

    async get(sql, params = []) {
        const adapted = this.adaptSql(sql);
        const { text, values } = this._toPg(adapted, params);
        const result = await this.pool.query(text, values);
        return result.rows[0] || null;
    }

    async all(sql, params = []) {
        const adapted = this.adaptSql(sql);
        const { text, values } = this._toPg(adapted, params);
        const result = await this.pool.query(text, values);
        return result.rows || [];
    }

    async transaction(fn) {
        const client = await this.pool.connect();
        const txDb = {
            dialect: 'postgres',
            adaptSql: (s) => this.adaptSql(s),
            run: async (sql, params = []) => {
                const adapted = this.adaptSql(sql);
                const { text, values } = this._toPg(adapted, params);
                const result = await client.query(text, values);
                return { id: result.rows[0]?.id, changes: result.rowCount };
            },
            get: async (sql, params = []) => {
                const adapted = this.adaptSql(sql);
                const { text, values } = this._toPg(adapted, params);
                const result = await client.query(text, values);
                return result.rows[0] || null;
            },
            all: async (sql, params = []) => {
                const adapted = this.adaptSql(sql);
                const { text, values } = this._toPg(adapted, params);
                const result = await client.query(text, values);
                return result.rows || [];
            }
        };
        try {
            await client.query('BEGIN');
            const result = await fn(txDb);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgresDatabase;
