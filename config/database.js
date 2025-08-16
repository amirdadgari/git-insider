const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class Database {
    constructor() {
        const configuredPath = (process.env.DB_PATH || './database/app.db').trim();
        // Resolve to absolute. If relative, resolve from project root (one level up from this file)
        const projectRoot = path.resolve(__dirname, '..');
        let resolved = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(projectRoot, configuredPath);

        // If the resolved path is a directory (or ends with a path separator), append a default filename
        try {
            if ((fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()) || resolved.endsWith(path.sep)) {
                resolved = path.join(resolved, 'app.db');
            }
        } catch (_) {
            // ignore stat errors here; we'll create the path later
        }

        this.dbPath = resolved;
        this.db = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            // Ensure the database directory exists so SQLite can create the file if needed
            try {
                const dir = path.dirname(this.dbPath);
                fs.mkdirSync(dir, { recursive: true });
                // Verify read/write access to the directory
                fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
                // Pre-create the database file if it doesn't exist to avoid permission issues
                if (!fs.existsSync(this.dbPath)) {
                    const fd = fs.openSync(this.dbPath, 'a');
                    fs.closeSync(fd);
                }
            } catch (mkdirErr) {
                console.error('Failed to ensure database directory exists:', mkdirErr);
                return reject(mkdirErr);
            }

            console.log('Using SQLite database at:', this.dbPath);

            this.db = new sqlite3.Database(
                this.dbPath,
                sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                (err) => {
                if (err) {
                    console.error('Error connecting to database:', err);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database');
                    this.initializeSchema().then(resolve).catch(reject);
                }
                }
            );
        });
    }

    async initializeSchema() {
        const schemas = [
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                role TEXT DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // API Tokens table
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
            
            // Git repositories table
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
            
            // Workspaces (root folders) table
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
            
            // User permissions for repositories
            `CREATE TABLE IF NOT EXISTS user_repository_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                repository_id INTEGER NOT NULL,
                permission TEXT DEFAULT 'read',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (repository_id) REFERENCES git_repositories(id) ON DELETE CASCADE,
                UNIQUE(user_id, repository_id)
            )`
        ];

        for (const schema of schemas) {
            await this.run(schema);
        }

        // Apply lightweight migrations to extend existing tables
        await this.migrate();

        // Create default admin user
        await this.createDefaultAdmin();
    }

    async migrate() {
        try {
            const columns = await this.all("PRAGMA table_info('git_repositories')");
            const has = (name) => Array.isArray(columns) && columns.some(c => c.name === name);

            if (!has('display_name')) {
                await this.run("ALTER TABLE git_repositories ADD COLUMN display_name TEXT");
            }
            if (!has('scm')) {
                await this.run("ALTER TABLE git_repositories ADD COLUMN scm TEXT");
            }
            if (!has('scm_fullpath')) {
                await this.run("ALTER TABLE git_repositories ADD COLUMN scm_fullpath TEXT");
            }
        } catch (err) {
            console.error('Migration error:', err.message || err);
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

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
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
                else resolve(rows);
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;
