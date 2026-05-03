/**
 * Tests for lib/customerKey.js
 *
 * Run: node --test tests/customerKey.test.mjs
 *
 * Stubs global fetch to drive the Supabase RPC + Anthropic-validate paths
 * without real credentials.
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

let mod;
const realFetch = global.fetch;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-platform-default';
  mod = await import('../lib/customerKey.js');
});

afterEach(() => { global.fetch = realFetch; mod.invalidateKeyCache({}); });

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

describe('maskKey + fingerprintKey', () => {
  test('keeps prefix + last 4', () => {
    assert.equal(mod.maskKey('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaXYZW'), 'sk-ant-...XYZW');
  });
  test('handles short / invalid input', () => {
    assert.equal(mod.maskKey(''), '***');
    assert.equal(mod.maskKey(null), '***');
    assert.equal(mod.maskKey('short'), '***');
  });
  test('fingerprintKey == maskKey (audit table consistency)', () => {
    const k = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaXYZW';
    assert.equal(mod.fingerprintKey(k), mod.maskKey(k));
  });
});

describe('daysUntilRotation', () => {
  test('returns positive for future date', () => {
    const future = new Date(Date.now() + 30 * 86400_000).toISOString();
    assert.ok(mod.daysUntilRotation(future) >= 29);
  });
  test('returns negative for past date', () => {
    const past = new Date(Date.now() - 5 * 86400_000).toISOString();
    assert.ok(mod.daysUntilRotation(past) < 0);
  });
  test('returns null for missing input', () => {
    assert.equal(mod.daysUntilRotation(null), null);
  });
});

describe('resolveActiveKey', () => {
  test('falls back to platform key when no orgId', async () => {
    const r = await mod.resolveActiveKey({ orgId: null, vendor: 'anthropic' });
    assert.equal(r.source, 'platform');
    assert.equal(r.key, 'sk-ant-platform-default');
  });

  test('returns customer key when RPC has one', async () => {
    stubFetch((url) => {
      if (url.includes('/rpc/get_active_customer_api_key')) {
        return { body: [{
          raw_key: 'sk-ant-customer-XYZW',
          fingerprint: 'sk-ant-...XYZW',
          key_id: 'kid-1',
          set_at: '2026-04-01T00:00:00Z',
          rotation_due_at: '2026-07-01T00:00:00Z',
        }] };
      }
      return { body: null };
    });
    const r = await mod.resolveActiveKey({ orgId: 'org-1', vendor: 'anthropic' });
    assert.equal(r.source, 'customer');
    assert.equal(r.key, 'sk-ant-customer-XYZW');
    assert.equal(r.fingerprint, 'sk-ant-...XYZW');
    assert.equal(r.keyId, 'kid-1');
  });

  test('falls back to platform when RPC returns nothing', async () => {
    stubFetch((url) => {
      if (url.includes('/rpc/get_active_customer_api_key')) return { body: [] };
      return { body: null };
    });
    const r = await mod.resolveActiveKey({ orgId: 'org-1', vendor: 'anthropic' });
    assert.equal(r.source, 'platform');
  });

  test('caches the customer key for 60s (no second RPC call)', async () => {
    let calls = 0;
    stubFetch((url) => {
      if (url.includes('/rpc/get_active_customer_api_key')) {
        calls += 1;
        return { body: [{ raw_key: 'sk-ant-cached', fingerprint: 'sk-ant-...ched', key_id: 'k', set_at: '...', rotation_due_at: '...' }] };
      }
      return { body: null };
    });
    await mod.resolveActiveKey({ orgId: 'org-cache', vendor: 'anthropic' });
    await mod.resolveActiveKey({ orgId: 'org-cache', vendor: 'anthropic' });
    await mod.resolveActiveKey({ orgId: 'org-cache', vendor: 'anthropic' });
    assert.equal(calls, 1);
  });
});

describe('setCustomerKey', () => {
  test('rejects obviously bad input early (no Supabase call)', async () => {
    let touched = false;
    stubFetch(() => { touched = true; return { body: null }; });
    const r1 = await mod.setCustomerKey({ orgId: 'o', vendor: 'anthropic', rawKey: 'short', actorEmail: 'a@b' });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /short/);
    assert.equal(touched, false);  // Validation happened before Supabase

    const r2 = await mod.setCustomerKey({ orgId: 'o', vendor: 'unknown', rawKey: 'sk-ant-something-long-enough', actorEmail: 'a@b' });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /vendor/i);
  });

  test('calls validation endpoint then RPC on a valid key', async () => {
    const calls = [];
    stubFetch((url, opts) => {
      calls.push(url);
      if (url.includes('api.anthropic.com/v1/messages')) return { status: 200, body: { content: [{ text: 'ok' }] } };
      if (url.includes('/rpc/set_customer_api_key')) return { body: 'kid-new' };
      return { body: null };
    });
    const r = await mod.setCustomerKey({
      orgId: 'org-1', vendor: 'anthropic',
      rawKey: 'sk-ant-' + 'x'.repeat(60),
      actorEmail: 'admin@co', actorUserId: 'u1', requestId: 'req-1',
    });
    assert.equal(r.ok, true);
    assert.equal(r.keyId, 'kid-new');
    assert.match(r.fingerprint, /^sk-ant-\.\.\./);
    assert.ok(calls.some((u) => u.includes('api.anthropic.com')));
    assert.ok(calls.some((u) => u.includes('/rpc/set_customer_api_key')));
  });

  test('rejects when validation 401s (key bad)', async () => {
    stubFetch((url) => {
      if (url.includes('api.anthropic.com')) return new Response('unauthorized', { status: 401 });
      return { body: null };
    });
    const r = await mod.setCustomerKey({
      orgId: 'org-1', vendor: 'anthropic',
      rawKey: 'sk-ant-bad-key-but-long-enough-to-pass-shape-check',
      actorEmail: 'admin@co',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /401|reject/i);
  });

  test('OpenAI: rejects keys without sk- prefix before any network call', async () => {
    let touched = false;
    stubFetch(() => { touched = true; return { body: null }; });
    const r = await mod.setCustomerKey({
      orgId: 'o', vendor: 'openai',
      rawKey: 'not-an-openai-key-but-long-enough',
      actorEmail: 'a@b',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /sk-/);
    assert.equal(touched, false);
  });

  test('OpenAI: validates via /v1/models then writes via RPC', async () => {
    const calls = [];
    stubFetch((url, opts) => {
      calls.push({ url, method: opts?.method });
      if (url.includes('api.openai.com/v1/models')) {
        return { status: 200, body: { data: [{ id: 'gpt-5.4' }] } };
      }
      if (url.includes('/rpc/set_customer_api_key')) return { body: 'kid-openai' };
      return { body: null };
    });
    const r = await mod.setCustomerKey({
      orgId: 'org-1', vendor: 'openai',
      rawKey: 'sk-proj-' + 'x'.repeat(60),
      actorEmail: 'admin@co', actorUserId: 'u1', requestId: 'req-1',
    });
    assert.equal(r.ok, true);
    assert.equal(r.keyId, 'kid-openai');
    const validateCall = calls.find((c) => c.url.includes('api.openai.com/v1/models'));
    assert.ok(validateCall, 'OpenAI validation endpoint was called');
    assert.equal(validateCall.method, 'GET', 'OpenAI validation should be a GET (free)');
    assert.ok(calls.some((c) => c.url.includes('/rpc/set_customer_api_key')));
  });

  test('OpenAI: rejects when /v1/models returns 401', async () => {
    stubFetch((url) => {
      if (url.includes('api.openai.com')) return new Response('unauthorized', { status: 401 });
      return { body: null };
    });
    const r = await mod.setCustomerKey({
      orgId: 'org-1', vendor: 'openai',
      rawKey: 'sk-bad-but-long-enough-to-pass-the-shape-check',
      actorEmail: 'admin@co',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /401|reject/i);
  });
});

describe('validateOpenAIKey', () => {
  test('rejects non-sk- prefix', async () => {
    const r = await mod.validateOpenAIKey('nope');
    assert.equal(r.valid, false);
    assert.match(r.reason, /sk-/);
  });
  test('returns valid on 200', async () => {
    stubFetch(() => ({ status: 200, body: { data: [] } }));
    const r = await mod.validateOpenAIKey('sk-proj-' + 'x'.repeat(40));
    assert.equal(r.valid, true);
  });
  test('returns reason on 403', async () => {
    stubFetch(() => new Response('forbidden', { status: 403 }));
    const r = await mod.validateOpenAIKey('sk-' + 'x'.repeat(40));
    assert.equal(r.valid, false);
    assert.match(r.reason, /forbidden|scope/i);
  });
});

describe('CustomerKeyError', () => {
  test('has expected shape for catch blocks', () => {
    const e = new mod.CustomerKeyError('bad', { vendor: 'anthropic', orgId: 'o', status: 402 });
    assert.equal(e.name, 'CustomerKeyError');
    assert.equal(e.status, 402);
    assert.equal(e.vendor, 'anthropic');
  });
});
