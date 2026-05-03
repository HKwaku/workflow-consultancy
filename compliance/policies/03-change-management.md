# Change Management Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Engineering Manager] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual |
| SOC 2 mapping | CC8.1, CC3.4 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To ensure changes to production systems are authorised, tested, documented, and reversible.

## 2. Scope

All changes to production infrastructure, application code, database schemas, third-party integrations, and security configurations.

## 3. Categories of change

| Category | Definition | Approval |
|---|---|---|
| **Standard** | Routine, low-risk, well-understood (e.g., dependency bump within minor version, feature flag toggle) | One reviewer; PR merge |
| **Normal** | Customer-visible feature, schema change, new integration | One reviewer + product/PM acknowledgement |
| **Major** | Breaking change, data migration touching > 10k rows, vendor swap, auth/authorisation change | One reviewer + Security Officer + scheduled deploy window |
| **Emergency** | Production-down or security-critical | One reviewer post-merge; full retrospective within 5 business days |

## 4. Change workflow

4.1. All changes are made on a feature branch.
4.2. A pull request is opened against `main`. Direct pushes to `main` are blocked at the platform level.
4.3. The PR description includes: what changed, why, how it was tested, rollback plan.
4.4. Automated checks (tests, lint, type checks, security scans) must pass before merge.
4.5. At least one Engineering reviewer (not the author) approves the PR.
4.6. CI/CD deploys merged commits to production.

## 5. Database migrations

5.1. Schema changes are committed as SQL files under `supabase/migration-*.sql`.
5.2. Migrations are documented in `supabase/MIGRATIONS.md` (chronological log).
5.3. Migrations must be **forward-only**; rollback is achieved by a new compensating migration.
5.4. Destructive migrations (DROP, NOT NULL on existing data) require Major-class approval.
5.5. Backfills touching > 10k rows are run in batches with documented commit cadence.

## 6. Testing

6.1. New code requires unit tests for non-trivial logic.
6.2. Changes to security-sensitive code (auth, RLS, evidence verification) require integration tests.
6.3. The full test suite must pass in CI before merge.

## 7. Deployment

7.1. Deployments are automated (Vercel for the application; Supabase migrations applied via Supabase Studio or CLI).
7.2. Vercel Preview deploys provide pre-merge review.
7.3. Production deploys are observable via the deployment log; failures alert via Sentry.

## 8. Rollback

8.1. Code rollback: revert PR + redeploy (Vercel makes prior deploy promotable in one click).
8.2. Data rollback: compensating migration; for severe data corruption see `RUNBOOK_BACKUP_RESTORE.md`.

## 9. Change documentation

The `supabase/MIGRATIONS.md` ledger and the git log together constitute the change record. PR descriptions provide change context. The Security Officer may sample changes during quarterly reviews.

## 10. Enforcement

Bypassing change management (direct production edits, unsigned-off Major changes) is a violation under the [Information Security Policy §9](01-information-security.md).
