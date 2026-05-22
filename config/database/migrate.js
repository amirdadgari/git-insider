const fs = require('fs');
const path = require('path');

async function runMigrations(db) {
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        const name = file;
        const existing = await db.get(
            'SELECT name FROM schema_migrations WHERE name = ?',
            [name]
        );
        if (existing) continue;

        const raw = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        if (!raw.trim()) {
            await db.run('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
            continue;
        }

        const adapted = db.adaptSql ? db.adaptSql(raw) : raw;
        if (typeof db.exec === 'function') {
            await db.exec(adapted);
        } else {
            const statements = adapted
                .split(';')
                .map((s) => s.trim())
                .filter((s) => s.length > 0 && !s.startsWith('--'));
            for (const statement of statements) {
                await db.run(statement);
            }
        }

        await db.run('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
        console.log(`Applied migration: ${name}`);
    }

    await ensureRepoColumns(db);
    await ensureFilesIndexedAt(db);
}

async function ensureFilesIndexedAt(db) {
    const hasColumn = await commitsHasColumn(db, 'files_indexed_at');
    if (!hasColumn) {
        const type = db.dialect === 'postgres' ? 'TIMESTAMPTZ' : 'DATETIME';
        await db.run(`ALTER TABLE commits ADD COLUMN files_indexed_at ${type}`);
    }
    await db.run(`
        UPDATE commits
        SET files_indexed_at = CURRENT_TIMESTAMP
        WHERE files_indexed_at IS NULL
          AND id IN (SELECT DISTINCT commit_id FROM commit_files)
    `);
}

async function commitsHasColumn(db, name) {
    if (db.dialect === 'postgres') {
        const row = await db.get(
            `SELECT 1 AS ok FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'commits' AND column_name = ?`,
            [name]
        );
        return !!row;
    }
    const columns = await db.all("PRAGMA table_info('commits')");
    return columns.some((c) => c.name === name);
}

async function ensureRepoColumns(db) {
    if (db.dialect === 'postgres') return;
    const columns = await db.all("PRAGMA table_info('git_repositories')");
    const has = (name) => columns.some((c) => c.name === name);
    if (!has('folder_name')) {
        await db.run('ALTER TABLE git_repositories ADD COLUMN folder_name TEXT');
    }
    if (!has('gitlab_project_id')) {
        await db.run('ALTER TABLE git_repositories ADD COLUMN gitlab_project_id INTEGER');
    }
}

module.exports = { runMigrations };
