# First-admin seeding (spec task 2)

Operator procedure that creates the very first admin. Run the steps in order:
sign up while public signup is still open → insert the Auth user id into the
allowlist → close public signup (see `admin-signup-closure-checklist.md`).

> Secrets rule: API keys live only in the compose stack's own `.env`, which is
> outside this repo and never committed here. The placeholders below
> (`<PUBLISHABLE_KEY>`, `<ADMIN_EMAIL>`, `<STRONG_PASSWORD>`) are filled in by
> the operator from their local files and are never pasted into the repo.

## Preconditions

- Local stack up; API base is `http://localhost:8000`, Auth at
  `http://localhost:8000/auth/v1`.
- Public signup is still open (fresh stack default). Confirm `auth.users` is
  empty before you start:
  `SELECT count(*) FROM auth.users;` → expect `0`.

## Step 1 — sign up the first admin via the local Auth API

While signup is still open, register the admin address (replace placeholders
with real values on your own machine only):

```bash
curl -s http://localhost:8000/auth/v1/signup \
  -H "apikey: <PUBLISHABLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<STRONG_PASSWORD>"}'
```

The JSON response contains the new user's id (top-level `user.id`, also echoed
as `id` in some client shapes). Save that UUID — it is the `<AUTH_USER_ID>`
used in step 2.

If the response shows the user still needs email confirmation (no session
returned), confirm the address first: check `ENABLE_EMAIL_AUTOCONFIRM` in your
compose `.env`, or confirm the user through the Auth admin API, then continue.
The admin cannot sign in until the address is confirmed.

Fallback if you lose the id: `SELECT id, email FROM auth.users ORDER BY
created_at DESC LIMIT 5;` and pick the row for `<ADMIN_EMAIL>`.

## Step 2 — insert the Auth user id into the allowlist

Run as database owner / service-role (bypasses RLS — there are deliberately no
insert policies on this table, so this cannot be done through the API):

```sql
INSERT INTO public.admins (auth_user_id)
VALUES ('<AUTH_USER_ID>')
ON CONFLICT (auth_user_id) DO NOTHING;
```

Verify:

```sql
SELECT auth_user_id, created_at FROM public.admins;
SELECT public.is_admin(); -- false here (no auth context); informational only
```

Expect exactly one row holding the UUID from step 1. The `auth.users` row must
exist first — the foreign key `admins_auth_user_id_fkey` rejects unknown ids.

## Step 3 — close public signup

Follow `docs/admin-signup-closure-checklist.md` now: set
`DISABLE_SIGNUP=true` in the compose `.env` and recreate the `auth` service.
Do not create any further users through the public endpoint after this point.

## Step 4 — verify the admin

1. Sign in with `<ADMIN_EMAIL>` through the app (or
   `POST /auth/v1/token?grant_type=password`).
2. As an authenticated admin, `SELECT * FROM public.admins;` returns the row
   (policy `admins_select_if_admin`, `USING (public.is_admin())`).
3. Negative check: sign-up attempts now fail with a signup-disabled error, and
   an unauthenticated request for the table is denied.

Further admins are added by an existing admin: create the Auth user through a
controlled path, then `INSERT` their id into `public.admins` the same way.
