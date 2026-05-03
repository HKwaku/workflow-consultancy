/**
 * Tests for lib/costGuard.js
 *
 * Run: node --test tests/costGuard.test.mjs
 *
 * We stub global fetch to drive the budget RPC + ledger insert without a
 * real Supabase. This validates the budget arithmetic + the over/under
 * branching logic.
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

let costGuard;
const realFetch = global.fetch;

// Mock supabase env so requireSupabase() returns truthy.
before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  costGuard = await import('../lib/costGuard.js');
});

afterEach(() => { global.fetch = realFetch; });

function stubFetch(handler) {
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

describe('preflightTokenBudget', () => {
  test('returns allowed=true when no orgId', async () => {
    const r = await costGuard.preflightTokenBudget({ orgId: null, estimatedTokens: 1000 });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_org');
  });

  test('returns allowed=true when org has no budget set (NULL)', async () => {
    stubFetch(() => ({
      body: [{
        id: 'org-1',
        monthly_token_budget: null,
        tokens_consumed_this_month: 5000,
        budget_period_started_at: '2026-04-01T00:00:00Z',
      }],
    }));
    const r = await costGuard.preflightTokenBudget({ orgId: 'org-1', estimatedTokens: 100000 });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'unlimited');
  });

  test('returns allowed=true when projected stays under budget', async () => {
    stubFetch(() => ({
      body: [{
        id: 'org-1',
        monthly_token_budget: 100000,
        tokens_consumed_this_month: 30000,
        budget_period_started_at: '2026-04-01T00:00:00Z',
      }],
    }));
    const r = await costGuard.preflightTokenBudget({ orgId: 'org-1', estimatedTokens: 50000 });
    assert.equal(r.allowed, true);
    assert.equal(r.projected, 80000);
  });

  test('returns allowed=false when projected exceeds budget', async () => {
    stubFetch(() => ({
      body: [{
        id: 'org-1',
        monthly_token_budget: 100000,
        tokens_consumed_this_month: 80000,
        budget_period_started_at: '2026-04-01T00:00:00Z',
      }],
    }));
    const r = await costGuard.preflightTokenBudget({ orgId: 'org-1', estimatedTokens: 30000 });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'over_budget');
    assert.equal(r.budget, 100000);
    assert.equal(r.consumed, 80000);
    assert.equal(r.projected, 110000);
  });

  test('returns allowed=true on Supabase fetch failure (soft-pass)', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const r = await costGuard.preflightTokenBudget({ orgId: 'org-1', estimatedTokens: 1 });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_org_state');
  });
});

describe('recordTokenUsage', () => {
  let calls;
  beforeEach(() => { calls = []; });

  test('returns zero_tokens early when total is 0', async () => {
    const r = await costGuard.recordTokenUsage({
      orgId: 'org-1', vendor: 'anthropic', surface: 'test',
      inputTokens: 0, outputTokens: 0,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'zero_tokens');
  });

  test('appends to ledger and bumps org total on a normal call', async () => {
    stubFetch((url, opts) => {
      calls.push({ url, body: opts?.body });
      if (url.includes('/rest/v1/token_usage_ledger')) return { status: 201, body: null };
      if (url.includes('/rest/v1/rpc/bump_token_usage')) return { body: 12345 };
      if (url.includes('/rest/v1/organizations')) {
        return { body: [{ id: 'org-1', monthly_token_budget: 100000, tokens_consumed_this_month: 12345, budget_period_started_at: '...', budget_alerted_at_80pct: '2026-04-01' }] };
      }
      return { body: null };
    });

    const r = await costGuard.recordTokenUsage({
      orgId: 'org-1', vendor: 'anthropic', model: 'claude-sonnet-4-6',
      surface: 'deal_analysis:diligence', refId: 'deal-1',
      inputTokens: 1000, outputTokens: 345, userEmail: 'a@b.com',
    });
    assert.equal(r.allowed, true);
    assert.equal(r.total, 1345);

    // Ledger insert happened
    const ledgerCall = calls.find((c) => c.url.includes('/token_usage_ledger'));
    assert.ok(ledgerCall, 'ledger insert should fire');
    const body = JSON.parse(ledgerCall.body);
    assert.equal(body.organization_id, 'org-1');
    assert.equal(body.total_tokens, 1345);
    assert.equal(body.surface, 'deal_analysis:diligence');

    // RPC bump happened
    const rpcCall = calls.find((c) => c.url.includes('/bump_token_usage'));
    assert.ok(rpcCall, 'RPC bump should fire');
    const rpcBody = JSON.parse(rpcCall.body);
    assert.equal(rpcBody.p_org_id, 'org-1');
    assert.equal(rpcBody.p_tokens, 1345);
  });

  test('returns over_budget when RPC raises token_budget_exceeded', async () => {
    stubFetch((url) => {
      if (url.includes('/token_usage_ledger')) return { status: 201, body: null };
      if (url.includes('/bump_token_usage')) {
        return new Response('{"message":"token_budget_exceeded","detail":"..."}', { status: 400 });
      }
      return { body: null };
    });

    const r = await costGuard.recordTokenUsage({
      orgId: 'org-1', vendor: 'anthropic', surface: 'test',
      inputTokens: 50000, outputTokens: 0,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'over_budget');
  });

  test('records ledger but skips bump when no orgId', async () => {
    stubFetch((url) => {
      calls.push(url);
      if (url.includes('/token_usage_ledger')) return { status: 201, body: null };
      return { body: null };
    });

    const r = await costGuard.recordTokenUsage({
      orgId: null, vendor: 'anthropic', surface: 'test',
      inputTokens: 100, outputTokens: 50,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_org');
    assert.ok(calls.some((u) => u.includes('/token_usage_ledger')));
    assert.ok(!calls.some((u) => u.includes('/bump_token_usage')));
  });
});
