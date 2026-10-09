# Teachers' Day Voting System

A department-isolated, two-stage voting application built for fair, secure, and verifiable faculty recognition during Teachers' Day elections.

---

## 🌟 Overview

The **Teachers' Day Voting System** conducts a structured, two-phase election to select one honored faculty member per academic department:

1. **Stage 1 (Faculty Peer Voting)**: Faculty members cast single-use votes within their department to advance the **Top-3 Finalists**.
2. **Stage 2 (Student Voting)**: Enrolled students cast votes among the departmental finalists to determine the **Department Winner**.

The platform is designed with cryptographic token security, strict department isolation, tamper-resistant audit logs, and atomic database transactions.

---

## ✨ Features

- **Two-Stage Election Lifecycle**: Full state management transitioning smoothly across `DRAFT` ➔ `STAGE_1_OPEN` ➔ `STAGE_1_CLOSED` ➔ `STAGE_2_OPEN` ➔ `STAGE_2_CLOSED` ➔ `RESULTS_RELEASED`.
- **Single-Use Voting Tokens & Codes**:
  - Voters receive distinct, human-readable voting codes (and printable QR codes).
  - Cryptographically secured with SHA-256 peppered hashing (`VOTING_TOKEN_PEPPER`); plain-text codes are never stored in the database.
  - Invalidation, revocation, and re-minting support for administrative control.
- **Department Isolation**:
  - Independent candidate pools and voting tokens per department.
  - Strict boundary enforcement ensuring voters only participate within their designated academic unit.
- **Atomic Transactions & Double-Vote Prevention**:
  - Core voting logic is executed via PostgreSQL atomic functions (`cast_vote`, `cast_student_vote`).
  - Strict concurrency controls prevent replay attacks, double spending, and race conditions.
- **Comprehensive Admin Suite**:
  - Department and faculty roster management (with CSV batch imports).
  - Bulk token generation with printable sheet layouts and QR codes.
  - Live election monitors, turnout metrics, tie-breaking policy enforcement, and immutable audit logs.
- **Privacy & Auditability**:
  - Ballots are dissociated from individual voter identities to ensure secret voting.
  - Administrative actions, stage transitions, and operational events are logged with tamper-evident audit trails.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Server Actions)
- **UI Library**: [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) / [Base UI](https://base-ui.com/)
- **Icons & QR**: [Lucide React](https://lucide.dev/), `react-qr-code`
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL 17, Row Level Security, GoTrue Auth)
- **Validation**: [Zod](https://zod.dev/)
- **Testing**: [Playwright](https://playwright.dev/), custom self-test test runners (`test:security`, `test:e2e` via `jiti`)

---

## 📁 Repository Structure

```text
├── app/
│   ├── admin/                # Admin control center (departments, faculty, tokens, audit logs)
│   ├── api/                  # API endpoints
│   ├── results/              # Public election results display
│   ├── vote/                 # Voter landing and token redemption interface
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Landing page
├── components/               # Shared UI and design system components
├── db/
│   └── migrations/           # PostgreSQL schema, RLS policies, and RPC transaction functions
├── docs/                     # Operations guides, security checklists, and specifications
├── lib/
│   ├── audit/                # Audit logging infrastructure
│   ├── auth/                 # Admin authentication and session handling
│   ├── departments/          # Department actions and data access
│   ├── election/             # Election lifecycle and stage transition actions
│   ├── faculty/              # Faculty roster management
│   ├── tokens/               # Token hashing, generation, minting, and validation
│   └── vote/                 # Vote casting actions and rate limiting
├── scripts/                  # Administrative maintenance scripts (e.g., audit log purges)
└── supabase/                 # Supabase configuration and migration utilities
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20 or later
- **npm** / **pnpm**
- **Docker** & **Docker Compose** (for local Supabase instance)

### 1. Clone & Install

```bash
git clone https://github.com/lloydshinee/teacher.git
cd teacher
npm install
```

### 2. Environment Configuration

Copy the example environment template:

```bash
cp .env.example .env.local
```

Populate `.env.local` with your Supabase credentials and a 64-character cryptographic pepper:

```env
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SECRET_KEY=your_supabase_secret_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Generate a 32-byte hex pepper:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
VOTING_TOKEN_PEPPER=your_64_character_hex_pepper
```

### 3. Database Setup

Apply the SQL migrations sequentially located in `db/migrations/`:

```bash
# Example using psql or Supabase SQL Editor:
psql "$DATABASE_URL" -f db/migrations/001_admins_allowlist.sql
psql "$DATABASE_URL" -f db/migrations/002_core_election.sql
psql "$DATABASE_URL" -f db/migrations/003_voting.sql
psql "$DATABASE_URL" -f db/migrations/004_cast_vote.sql
psql "$DATABASE_URL" -f db/migrations/005_cast_student_vote.sql
```

For first admin bootstrap and auth hardening instructions, consult [`docs/setup-and-run.md`](./docs/setup-and-run.md).

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Quality Assurance

```bash
# Type check TypeScript files
npm run typecheck

# Lint source code
npm run lint

# Run security test suite (atomicity, token replay, tampering, RLS)
npm run test:security

# Run election lifecycle end-to-end tests
npm run test:e2e

# Run Playwright browser tests
npm run test:browser
```

---

## 🔒 Security & Privacy Model

- **Zero Plain-Text Token Storage**: Voting codes are hashed immediately with a secret server-side pepper before storage and lookup.
- **Vote Secrecy**: The system maintains an unlinked relationship between tokens and votes cast to guarantee anonymity.
- **Rate Limiting**: In-memory and database guards protect voter endpoints against brute force token guessing.
- **Role Isolation**: Admin capabilities are restricted to an allowlist with verified sessions and RLS enforcement.

---

## 📄 Documentation

- [Setup and Run Guide](./docs/setup-and-run.md)
- [Pre-launch Checklist](./docs/pre-launch-checklist.md)
- [Admin Seeding Guide](./docs/admin-first-seeding.md)
- [Glossary and Terminology](./GLOSSARY.md)

---

## 📄 License

Private & proprietary. All rights reserved.
