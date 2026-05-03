# Backup & Recovery Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Engineering Manager] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual + after every backup architecture change |
| SOC 2 mapping | A1.2, A1.3, CC6.5, CC7.5 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To ensure that critical data is regularly backed up, that backups are restorable, and that restores are tested.

## 2. Scope

| Asset | Backup mechanism | Frequency | Retention |
|---|---|---|---|
| Postgres (Supabase) | Supabase managed backup + point-in-time recovery | Daily snapshot + WAL | 30 days (Pro) / 90 days (Enterprise — confirm tier) |
| Storage (Supabase Storage) | Supabase replication + secondary copy in [SECONDARY STORE] | Continuous + nightly secondary | 90 days |
| Source code | GitHub primary + weekly mirror to [SECONDARY GIT REMOTE] | Continuous + weekly | Indefinite |
| Build configuration | Vercel project export documented; env vars stored in 1Password | Quarterly export | Indefinite |
| Audit logs | In Postgres, covered by Postgres backup | Daily | 12 months minimum |

The actual Supabase tier and retention are documented at **[LINK TO INFRASTRUCTURE NOTES]**; reconcile this row annually.

## 3. Encryption

3.1. Backups at rest are encrypted by the storage provider (Supabase, S3, GitHub).
3.2. Secondary copies are encrypted in transit (TLS) and at rest (server-side encryption).
3.3. No backup leaves the configured residency region without explicit approval.

## 4. Access

4.1. Restore operations require privileged access; only the on-call engineer and the Security Officer hold this.
4.2. Backup access is logged.
4.3. Customer-data exports for support cases require ticket reference and customer consent.

## 5. Restore testing

5.1. **Quarterly partial restore:** restore a single table or a single tenant's documents to a non-production project; verify row count, sample integrity, and elapsed time vs RPO/RTO targets.
5.2. **Annual full restore:** restore the entire database to a non-production project; run smoke tests.
5.3. Each test produces a report (date, scope, target time, actual time, deviations, follow-ups).
5.4. Failed tests open a Sev2 incident.

The procedures for these tests are in `RUNBOOK_BACKUP_RESTORE.md`.

## 6. Recovery scenarios

| Scenario | Procedure |
|---|---|
| Single row corruption | Restore from PITR to a temp project; cherry-pick the row via SQL |
| Single table corruption | Restore from PITR; copy the table back |
| Full database loss | PITR restore; for region-loss failover, see `RUNBOOK_BACKUP_RESTORE.md` |
| Storage object deletion | Restore from secondary copy; if within Supabase versioning window, use that |
| Source code loss | Restore from secondary git mirror |
| Workstation loss | Re-provision device; data lives in cloud |

## 7. Customer data deletion vs backup

7.1. When a customer requests deletion under GDPR Article 17, the operational data is removed via the deletion flow (`app/api/account/`, `expunge-deleted-accounts` cron).
7.2. Backups are not selectively rewritten. Backed-up copies of deleted data are removed by **backup expiry** within the retention window stated in §2.
7.3. This handling is disclosed in the customer-facing privacy notice and DPA.

## 8. Backup monitoring

8.1. The Engineering Manager reviews backup status monthly (was the snapshot taken; was the secondary copy successful).
8.2. Failures alert via Sentry / [BACKUP MONITORING].

## 9. Off-platform copies

9.1. For Critical-tier customers requiring off-platform backup, a dedicated process is documented per contract.
9.2. Off-platform backups are subject to the same encryption, access, and retention controls as primary backups.
