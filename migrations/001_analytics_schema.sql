-- app_settings
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- gitlab_integration (single row id=1)
CREATE TABLE IF NOT EXISTS gitlab_integration (
    id INTEGER PRIMARY KEY,
    base_url TEXT,
    private_token TEXT,
    enabled INTEGER DEFAULT 0,
    last_sync_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- gitlab_users cache
CREATE TABLE IF NOT EXISTS gitlab_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gitlab_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    name TEXT,
    email TEXT,
    avatar_url TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- contributors (canonical identity)
CREATE TABLE IF NOT EXISTS contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    gitlab_user_id INTEGER,
    primary_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- contributor_aliases
CREATE TABLE IF NOT EXISTS contributor_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contributor_id INTEGER NOT NULL,
    author_name TEXT,
    author_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE CASCADE
);

-- commits index
CREATE TABLE IF NOT EXISTS commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL,
    hash TEXT NOT NULL,
    author_name TEXT,
    author_email TEXT,
    contributor_id INTEGER,
    committed_at TEXT NOT NULL,
    message TEXT,
    branch TEXT,
    is_merge INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repository_id) REFERENCES git_repositories(id) ON DELETE CASCADE,
    FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL,
    UNIQUE(repository_id, hash)
);

-- commit file stats
CREATE TABLE IF NOT EXISTS commit_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commit_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE
);

-- index coverage per repository
CREATE TABLE IF NOT EXISTS index_coverage (
    repository_id INTEGER PRIMARY KEY,
    oldest_indexed_at TEXT,
    newest_indexed_at TEXT,
    last_indexed_at DATETIME,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repository_id) REFERENCES git_repositories(id) ON DELETE CASCADE
);

-- scheduler status
CREATE TABLE IF NOT EXISTS scheduler_status (
    id INTEGER PRIMARY KEY,
    last_workspace_scan_at DATETIME,
    last_eviction_at DATETIME,
    last_error TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default settings
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('index_window_months', '3');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('retention_idle_days', '7');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('workspace_scan_interval_minutes', '30');

INSERT OR IGNORE INTO scheduler_status (id, updated_at) VALUES (1, CURRENT_TIMESTAMP);
