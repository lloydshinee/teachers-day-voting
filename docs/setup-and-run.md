# Setup and Run Guide · Teachers' Day Voting System

This guide covers bootstrapping and running the Teachers' Day voting application and its local Supabase backend.

---

## 1. Prerequisites

- **Node.js**: v20 or v22
- **npm** / **pnpm**
- **Docker** and **Docker Compose**
- **Git**

---

## 2. Local Supabase Infrastructure

The project backend runs via the local Supabase Docker Compose stack located in `/home/user/Documents/supabase/teacher` (or your local checkout).

### Starting the Database Stack
```bash
cd /path/to/supabase/teacher
docker compose up -d
```

Verify that all essential containers are healthy:
- `supabase-db` (PostgreSQL 17)
- `supabase-auth` (GoTrue Auth)
- `supabase-rest` (PostgREST)
- `supabase-envoy` (API Gateway on port 8000)
- `supabase-meta` (Postgres Meta)

### MCP Server Integration
The API Gateway exposes the Supabase Model Context Protocol (MCP) endpoint at `http://localhost:8000/mcp`. It supports JSON-RPC 2.0 tools including `list_tables`, `execute_sql`, `get_advisors`, and `apply_migration`.

---

## 3. Environment Configuration

Create or verify `.env.local` in the application root (never commit this file):

```bash
# Public URL for the API Gateway
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000

# Modern publishable key and legacy anon key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Server-only service role key and secret key (used for atomic vote transactions)
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Cryptographic token pepper (never commit; used for SHA-256 peppered hashing of voting codes)
VOTING_TOKEN_PEPPER=694a843545cab8ed10c500e8dec1b6d7fb2f22339068b9729417d83e8c50394e
```

---

## 4. Database Migrations

Apply database migrations in sequential order from `db/migrations/`:

```bash
# 001: Admins allowlist table and is_admin() function
# 002: Core election and department schema
# 003: Voting tokens, votes, finalists, and audit logs
# 004: Atomic cast_vote() transaction function
# 005: Atomic cast_student_vote() transaction function
```

You can execute SQL queries directly using the Supabase MCP `execute_sql` tool or via `psql`:

```bash
docker exec -i supabase-db psql -U postgres -d postgres < db/migrations/001_admins_allowlist.sql
docker exec -i supabase-db psql -U postgres -d postgres < db/migrations/002_core_election.sql
docker exec -i supabase-db psql -U postgres -d postgres < db/migrations/003_voting.sql
docker exec -i supabase-db psql -U postgres -d postgres < db/migrations/004_cast_vote.sql
docker exec -i supabase-db psql -U postgres -d postgres < db/migrations/005_cast_student_vote.sql
```

---

## 5. First Admin Bootstrap & Auth Hardening

1. **Seed First Admin**:
   Create an auth user in Supabase Auth, then insert the user's UUID into `public.admins`. See [`docs/admin-first-seeding.md`](./admin-first-seeding.md) for detailed SQL commands.

2. **Close Public Signup**:
   Set `ENABLE_SIGNUP=false` in the GoTrue service configuration to ensure random users cannot register as admins. See [`docs/admin-signup-closure-checklist.md`](./admin-signup-closure-checklist.md).

---

## 6. Running the Web Application

### Development Mode
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the portal.

### Production Build
```bash
npm run build
npm run start
```

---

## 7. Running Test Suites

Verify election lifecycle and security constraints before launching:

```bash
# Run security suite (48 checks: atomicity, replay, forging prevention, RLS)
npm run test:security

# Run end-to-end election lifecycle suite (35 checks)
npm run test:e2e

# Run linter and typecheck
npm run typecheck
npm run lint
```
