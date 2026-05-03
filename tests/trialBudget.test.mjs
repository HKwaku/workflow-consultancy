/**
 * Tests for lib/trialBudget.js — resolveBudgetMode + requireBudgetClearance.
 *
 * Stubs global fetch to drive the four code paths (anonymous, trial,
 * trial_exhausted, org_byo, org_platform) without a live Supabase.
 *
 * Run: node --test tests/trialBudget.test.mjs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let mod;
const realFetch = global.fetch;

beforeEach(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-platform-default';
  if (!mod) mod = await import('../lib/trialBudget.js');
});

afterEach(() => { global.fetch = realFetch; });

function stub(handler) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    const result = await handler(u, opts);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result.body ?? null), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('resolveBudgetMode', () => {
  test('anonymous when no userId', async () => {
    const r = await mod.resolveBudgetMode({});
    assert.equal(r.mode, 'anonymous');
  });

  test('trial when no org membership and allowance has remaining', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [] }; // no org
      if (u.includes('get_user_trial_allowance')) {
        return { body: [{ granted_tokens: 50000, consumed_tokens: 12000, exhausted: false, granted_at: new Date().toISOString() }] };
      }
      return { body: [] };
    });
    const r = await mod.resolveBudgetMode({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.mode, 'trial');
    assert.equal(r.granted, 50000);
    assert.equal(r.remaining, 38000);
  });

  test('trial_exhausted when allowance is used up', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [] };
      if (u.includes('get_user_trial_allowance')) {
        return { body: [{ granted_tokens: 50000, consumed_tokens: 50000, exhausted: true, granted_at: new Date().toISOString() }] };
      }
      return { body: [] };
    });
    const r = await mod.resolveBudgetMode({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.mode, 'trial_exhausted');
    assert.equal(r.granted, 50000);
  });

  test('org_byo when org has a customer Anthropic key', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [{ organization_id: 'org-1' }] };
      if (u.includes('get_active_customer_api_key')) {
        return { body: [{ raw_key: 'sk-ant-customer', fingerprint: 'sk-ant-...abcd', key_id: 'k1' }] };
      }
      return { body: [] };
    });
    const r = await mod.resolveBudgetMode({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.mode, 'org_byo');
    assert.equal(r.orgId, 'org-1');
  });

  test('org_platform when org exists but no customer key', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [{ organization_id: 'org-2' }] };
      if (u.includes('get_active_customer_api_key')) return { body: [] };
      return { body: [] };
    });
    const r = await mod.resolveBudgetMode({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.mode, 'org_platform');
    assert.equal(r.orgId, 'org-2');
  });

  test('unknown when signed-in user but trial RPC fails / migration missing', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [] };
      if (u.includes('get_user_trial_allowance')) return new Response('not found', { status: 404 });
      return { body: [] };
    });
    const r = await mod.resolveBudgetMode({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.mode, 'unknown');
  });
});

describe('requireBudgetClearance', () => {
  test('blocks on trial_exhausted with create_org gate', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [] };
      if (u.includes('get_user_trial_allowance')) {
        return { body: [{ granted_tokens: 50000, consumed_tokens: 60000, exhausted: true, granted_at: new Date().toISOString() }] };
      }
      return { body: [] };
    });
    const r = await mod.requireBudgetClearance({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.allowed, false);
    assert.equal(r.gateAction, 'create_org');
    assert.equal(r.reason, 'trial_exhausted');
    assert.ok(r.message);
  });

  test('allows trial users with remaining allowance', async () => {
    stub(async (u) => {
      if (u.includes('organization_members')) return { body: [] };
      if (u.includes('get_user_trial_allowance')) {
        return { body: [{ granted_tokens: 50000, consumed_tokens: 1000, exhausted: false, granted_at: new Date().toISOString() }] };
      }
      return { body: [] };
    });
    const r = await mod.requireBudgetClearance({ email: 'a@b.c', userId: 'u1' });
    assert.equal(r.allowed, true);
    assert.equal(r.mode, 'trial');
  });

  test('allows anonymous (no gate when no userId)', async () => {
    const r = await mod.requireBudgetClearance({});
    assert.equal(r.allowed, true);
    assert.equal(r.mode, 'anonymous');
  });
});
