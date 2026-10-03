# Setup/run docs and pre-launch checklist

Type: task
Status: resolved
Blocked by: 01, 07

## What to deliver

Deliver complete operator setup/run documentation and the pre-launch election operational checklist as defined in spec §14 task 20:

- `docs/setup-and-run.md`: Local and production setup, Supabase compose stack, environment variables, migrations, first-admin bootstrap, and test execution.
- `docs/pre-launch-checklist.md`: The operational checklist for election administrators from creation to tie policy freezing, code export, stage progression, and winner publication.

## Acceptance criteria

- [x] `docs/setup-and-run.md` covers compose stack, env configuration, migration execution, and verification.
- [x] `docs/pre-launch-checklist.md` documents the step-by-step pre-launch procedure for election administrators.
- [x] Supabase MCP (`list_tables`, `execute_sql`, `get_advisors`) validated against the local environment.

## Answer (resolved 2026-10-02)

Completed task 20 of the architecture & implementation plan:
- Authored `docs/setup-and-run.md` covering Supabase Docker compose services, `.env.local` keys, token pepper configuration, migrations 001–005, first-admin allowlist seeding, and verification commands.
- Authored `docs/pre-launch-checklist.md` walking administrators through election creation, tie policy freeze, department roster verification, code generation/printing, stage transitions, tie resolution gates, and department winner publication.
- Confirmed full functionality of the local Supabase MCP server (`http://localhost:8000/mcp`) for database inspection and migrations.
