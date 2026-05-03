# Business Continuity & Disaster Recovery Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Engineering Manager] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual + after every restore drill |
| SOC 2 mapping | A1.2, A1.3, CC7.5 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To restore service and recover data within defined targets following any disruptive event — outage, data corruption, regional cloud failure, or successful cyber-attack.

## 2. Recovery objectives

| Class | RTO | RPO |
|---|---|---|
| Customer-facing application | 4 hours | 15 minutes |
| Customer documents (Supabase Storage) | 24 hours | 1 hour |
| Audit logs and ledgers | 24 hours | 24 hours |
| Internal tooling | 5 business days | 24 hours |

**RTO** = Recovery Time Objective (how quickly we restore service). **RPO** = Recovery Point Objective (how much data we can lose).

These targets are subject to the [SLA in the customer MSA] — customer commitments take precedence if stricter.

## 3. Backups

3.1. Postgres: Supabase managed daily backups + point-in-time recovery (PITR) enabled.
3.2. Storage: Supabase Storage replication; secondary copies of high-value uploads stored in [SECONDARY BACKUP — e.g., S3 bucket].
3.3. Source code: GitHub primary; weekly mirrored to [SECONDARY GIT REMOTE].
3.4. Configuration: environment variables documented in [SECURE STORE — e.g., 1Password vault].

See `RUNBOOK_BACKUP_RESTORE.md` for procedures.

## 4. Restore drills

4.1. A **full restore drill** is performed at least annually.
4.2. A **partial restore** (single table or single tenant's documents) is performed quarterly.
4.3. Drill results are documented (timestamps, who performed, what was restored, deviation from RTO/RPO).
4.4. Failed drills generate a remediation ticket with a 30-day SLA.

## 5. Failover

5.1. Application: Vercel automatic regional failover.
5.2. Database: Supabase managed failover. For region-loss scenarios, follow `RUNBOOK_BACKUP_RESTORE.md`.
5.3. DNS: TTL ≤ 300s on customer-facing records.

## 6. Communication during disruption

6.1. Status page updated within 15 min of confirmed disruption (see `RUNBOOK_STATUS_PAGE.md`).
6.2. Customer notification per the [Incident Response Policy §6](04-incident-response.md).

## 7. Workforce continuity

7.1. Workforce is fully remote-capable.
7.2. Critical credentials are stored in 1Password with at least two custodians.
7.3. Succession plan: each on-call role has a documented backup person.

## 8. Annual test

The full BC/DR plan (technical + communication + workforce) is exercised annually. Exercises rotate between: full restore drill, regional outage simulation, key-person unavailability.

## 9. Plan maintenance

This policy is reviewed annually. Material changes (new region, new RTO/RPO targets, new infrastructure) trigger out-of-cycle review.
