# Pre-Launch Checklist · Teachers' Day Voting System

This checklist must be executed by the election operator and administrative committee prior to and throughout the election lifecycle.

---

## Phase 1: Setup & Pre-Launch Hardening

- [ ] **Database & MCP Verification**: Ensure local Supabase containers are healthy and all migrations (`001` through `005`) are applied.
- [ ] **Public Signup Closed**: Verify `ENABLE_SIGNUP=false` on GoTrue (`docs/admin-signup-closure-checklist.md`).
- [ ] **Admin Allowlist Configured**: Confirm at least one verified administrator UUID exists in `public.admins` (`docs/admin-first-seeding.md`).
- [ ] **Pepper Configured**: Confirm `VOTING_TOKEN_PEPPER` is set in `.env.local` and never committed to version control.
- [ ] **Automated Test Suites Passed**: Run `npm run test:security` and `npm run test:e2e` to confirm all 83 assertions pass.

---

## Phase 2: Election Initialization

- [ ] **Create Election**: Navigate to `/admin` and create the new Election record (e.g., "Teachers' Day 2026", Academic Year "2026–2027").
- [ ] **Register Departments**: Add all participating academic departments (e.g., CCS, COED, CBA, CAS).
- [ ] **Enroll Faculty Members**: Populate the faculty roster per department. Confirm each faculty member's global department association is accurate.
- [ ] **Freeze Tie Policy**: Enter the official tie-breaking policy text in the election settings. Note: Once faculty voting closes, the tie policy version is permanently locked.

---

## Phase 3: Stage 1 — Faculty Peer Voting

- [ ] **Generate Missing Faculty Codes**: Under `/admin/faculty/codes`, click "Generate missing codes" to issue 1:1 single-use codes for all eligible faculty.
- [ ] **Print & Distribute Faculty Slips**: Use the browser Print function (`Ctrl+P` / `Cmd+P`) on `/admin/faculty/codes`. Slips render without screen chrome, displaying QR code deep-links and manual entry instructions.
- [ ] **Open Faculty Voting**: Advance election stage from `DRAFT` to `FACULTY_VOTING`.
- [ ] **Monitor Participation**: Track turnout aggregates on the Admin Dashboard (`/admin`).
- [ ] **Close Faculty Voting**: Advance election stage from `FACULTY_VOTING` to `FACULTY_RESULTS`.

---

## Phase 4: Stage 1 Close & Finalist Freeze

- [ ] **Review Department Ties**: Check dashboard for any "Tie detected for 3rd place" alerts.
- [ ] **Resolve Cutoff Ties**: If a tie exists at the 3rd-place boundary, perform manual tie resolution as stipulated in the frozen tie policy. The selection writes an audit log entry.
- [ ] **Freeze Top-3 Finalists**: Confirm all participating departments have locked Finalists. Sibling departments advance independently.

---

## Phase 5: Stage 2 — Student Final Voting

- [ ] **Issue Student Codes**: Under `/admin/student/codes`, specify the target quantity of codes per department and click "Generate Codes".
- [ ] **Print & Distribute Student Slips**: Print student slips for distribution at department polling desks.
- [ ] **Open Student Voting**: Advance stage from `FACULTY_RESULTS` to `STUDENT_VOTING`.
- [ ] **Monitor Student Turnout**: Review cast-versus-issued aggregates on `/admin`.
- [ ] **Close Student Voting**: Advance stage from `STUDENT_VOTING` to `FINAL_RESULTS`.

---

## Phase 6: Publication & Closure

- [ ] **Review Winner Ties**: Check for any ties for 1st place. Resolve under the locked tie policy if necessary.
- [ ] **Publish Department Winners**: For each department, trigger "Publish Winner". This writes the official published record (`election_results.published = true`).
- [ ] **Verify Public Results**: Visit `/results` to confirm the public honoree cards render cleanly with department codes, winner names, and finalist rankings.
- [ ] **Close Election**: Advance stage from `FINAL_RESULTS` to `CLOSED`. Any subsequent vote attempts or modifications are strictly rejected by the server state machine.
