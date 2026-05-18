const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class SqliteDatabase {
    constructor() {
        this.dialect = 'sqlite';
        const configuredPath = (process.env.DB_PATH || './database/app.db').trim();
        const projectRoot = path.resolve(__dirname, '..', '..');
        let resolved = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(projectRoot, configuredPath);

        try {
            if ((fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()) || resolved.endsWith(path.sep)) {
                resolved = path.join(resolved, 'app.db');
            }
        } catch (_) {}

        this.dbPath = resolved;
        this.db = null;
    }

    adaptSql(sql) {
        return sql;
    }

    likeOp() {
        return 'LIKE';
    }

    nowFn() {
        return "datetime('now')";
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                const dir = path.dirname(this.dbPath);
                fs.mkdirSync(dir, { recursive: true });
                if (!fs.existsSync(this.dbPath)) {
                    const fd = fs.openSync(this.dbPath, 'a');
                    fs.closeSync(fd);
                }
            } catch (mkdirErr) {
                return reject(mkdirErr);
            }

            console.log('Using SQLite database at:', this.dbPath);
            this.db = new sqlite3.Database(
                this.dbPath,
                sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                (err) => {
                    if (err) reject(err);
                    else {
                        console.log('Connected to SQLite database');
                        this.initializeSchema().then(resolve).catch(reject);
                    }
                }
            );
        });
    }

    async initializeSchema() {
        const schemas = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                role TEXT DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS api_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                name TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS git_repositories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                url TEXT,
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS workspaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                root_path TEXT UNIQUE NOT NULL,
                name TEXT,
                repo_count INTEGER DEFAULT 0,
                last_scanned_at DATETIME,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS user_repository_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                repository_id INTEGER NOT NULL,
                permission TEXT DEFAULT 'read',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (repository_id) REFERENCES git_repositories(id) ON DELETE CASCADE,
                UNIQUE(user_id, repository_id)
            )`,
            `CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        const columns = await this.all("PRAGMA table_info('git_repositories')");
        const has = (name) => Array.isArray(columns) && columns.some((c) => c.name === name);

        const adds = [
            ['display_name', 'TEXT'],
            ['scm', 'TEXT'],
            ['scm_fullpath', 'TEXT'],
            ['folder_name', 'TEXT'],
            ['gitlab_project_id', 'INTEGER'],
            ['display_name_custom', 'INTEGER DEFAULT 0']
        ];

        for (const [col, type] of adds) {
            if (!has(col)) {
                await this.run(`ALTER TABLE git_repositories ADD COLUMN ${col} ${type}`);
            }
        }
    }

    async createDefaultAdmin() {
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

        try {
            const existingAdmin = await this.get('SELECT * FROM users WHERE username = ?', [adminUsername]);
            if (!existingAdmin) {
                const hashedPassword = await bcrypt.hash(adminPassword, 10);
                await this.run(
                    'INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)',
                    [adminUsername, hashedPassword, `${adminUsername}@gitinsider.app`, 'admin']
                );
                console.log(`Default admin user created: ${adminUsername}`);
            }
        } catch (error) {
            console.error('Error creating default admin:', error);
        }
    }

    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => (err ? reject(err) : resolve()));
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function onRun(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async transaction(fn) {
        await this.run('BEGIN');
        try {
            const result = await fn(this);
            await this.run('COMMIT');
            return result;
        } catch (e) {
            await this.run('ROLLBACK');
            throw e;
        }
    }

    close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => (err ? reject(err) : resolve()));
            } else resolve();
        });
    }
}

module.exports = SqliteDatabase;
