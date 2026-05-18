CREATE INDEX IF NOT EXISTS idx_commits_repo_date ON commits(repository_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_commits_contributor_date ON commits(contributor_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_commits_hash ON commits(repository_id, hash);
CREATE INDEX IF NOT EXISTS idx_commits_author_email ON commits(author_email);
CREATE INDEX IF NOT EXISTS idx_commits_committed_at ON commits(committed_at);
CREATE INDEX IF NOT EXISTS idx_commit_files_commit ON commit_files(commit_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_email_name ON contributor_aliases(author_email, author_name);
CREATE INDEX IF NOT EXISTS idx_contributor_aliases_contributor ON contributor_aliases(contributor_id);
CREATE INDEX IF NOT EXISTS idx_gitlab_users_email ON gitlab_users(email);
