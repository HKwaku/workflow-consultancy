---
title: Entitlements
group: Reference
order: 1
summary: The four boolean flags that gate features per organisation member.
---

Entitlements live on `organization_members.entitlements` (a JSONB column). Each is a boolean; defaults are platform-wide.

| Key | Default | What it gates |
|-----|---------|---------------|
| `portal` | `true` | Access to `/workspace/map` and the authenticated process flow |
| `cost_analyst` | `false` | Edit cost inputs (labour rates, frequency, hours) on the live canvas. Without it, cost fields are read-only. |
| `deals` | `false` | Creating + editing deals; the Deals briefcase popover on the chat rail |
| `analytics` | `false` | The Analytics popover on the chat rail and workspace analytics tab (cross-process benchmarking) |

Plus one column override:

- `is_org_admin` (boolean) — overrides individual entitlements at the org level. Org admins can manage members and API keys regardless of per-key flags.

## How they're checked

Routes call `hasEntitlement(member.entitlements, 'deals')` from `lib/entitlements.js`. Pages render gates around the entire surface.

## How to set them

Org admin → `/org-admin` → Members → click a member → toggle entitlement checkboxes → Save.

Platform admin (you) — via SQL when bootstrapping:

```sql
UPDATE organization_members
   SET entitlements = '{"portal":true,"deals":true,"analytics":true,"cost_analyst":true}'::jsonb,
       is_org_admin = true
 WHERE lower(email) = lower('your.email@whatever.com');
```

## Adding a new entitlement

Defined in `lib/entitlements.js`'s `ENTITLEMENT_KEYS` array. Adding one:

1. Append to `ENTITLEMENT_KEYS`
2. Add it to `defaultEntitlements()`
3. Wire `hasEntitlement(...)` checks in the routes / components that need to gate
4. Existing org members keep `false` for the new key until an admin enables it

Defaults are deliberately conservative — new features land off; admins explicitly opt-in.
