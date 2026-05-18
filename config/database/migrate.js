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
