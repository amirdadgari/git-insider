# Git Insider

Git Insider is an Express-based web app that gives actionable insights into your Git repositories, with user management, API tokens, and a built-in GraphQL and REST API. It includes a single-page UI powered by Tailwind CSS.

## Features
- Work Spaces: save root folders and scan for repositories, then aggregate analytics across all saved spaces
- Git analytics: commits, authors, and repository insights via REST and GraphQL
- User management: admin panel for users and permissions
- API tokens: create/revoke tokens and use X-API-Key for API calls
- SPA with hash-based routing and Tailwind UI

## Tech Stack
- Node.js, Express
- SQLite (file DB) via `sqlite3`
- GraphQL via `@apollo/server`
- Tailwind CSS (CLI)

## Prerequisites
- Node.js 18+
- npm

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create an `.env` from `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. Adjust variables as needed.

### Environment variables
From `./.env.example`:
- `NODE_ENV=development`
- `PORT=3201`
- `JWT_SECRET=your_jwt_secret_key_here`
- `DB_PATH=./database/app.db`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=admin123`
- `GIT_REPOS_PATH=./repos`

## Running
- Dev server:
  ```bash
  npm run dev
  ```
- Build Tailwind (watch):
  ```bash
  npm run build:css
  ```
- Production:
  ```bash
  npm run build
  npm start
  ```

App serves the SPA from `public/` and views from `views/` at `http://localhost:PORT`.

## Docker
A simple setup is provided.
```bash
# build & run
docker compose up --build
```

## API Docs
- REST: `docs/REST-API.md`
- GraphQL: `docs/GRAPHQL-API.md`

The UI includes a "Try API" dialog that supports `Authorization: Bearer <JWT>` and `X-API-Key` headers.

## Project scripts
- `dev`: start with nodemon
- `build:css`: Tailwind CLI build (watch)
- `start`: run the server

## Notes
- SQLite database files live under `./database/` (ignored by git).
- Default admin is created on first launch if missing.

## License
MIT
