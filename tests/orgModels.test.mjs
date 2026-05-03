/**
 * Tests for lib/orgModels.js + lib/agents/modelCatalogue.js
 *
 * Run: node --test tests/orgModels.test.mjs
 *
 * Covers the resolver branches (org list / BYO default / platform) and
 * the catalogue helpers (filtering unknowns, fingerprinting). Stubs global
 * fetch to drive Supabase responses without real credentials.
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;
let catalogue, orgModels;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  catalogue  = await import('../lib/agents/modelCatalogue.js');
  orgModels  = await import('../lib/orgModels.js');
});

afterEach(() => { global.fetch = realFetch; });

function stubOrgRow(row) {
  global.fetch = async (url) => {
    if (String(url).includes('/rest/v1/organizations')) {
      return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

describe('modelCatalogue', () => {
  test('every catalogue entry has the required shape', () => {
    for (const m of catalogue.KNOWN_MODELS) {
      assert.equal(typeof m.id, 'string');
      assert.equal(typeof m.label, 'string');
      assert.ok(['fast', 'chat', 'deep'].includes(m.tier), `bad tier on ${m.id}`);
      assert.equal(typeof m.contextWindow, 'number');
      assert.equal(typeof m.deprecated, 'boolean');
    }
  });

  test('PLATFORM_ALLOWED_MODEL_IDS is a subset of the catalogue', () => {
    for (const id of catalogue.PLATFORM_ALLOWED_MODEL_IDS) {
      assert.ok(catalogue.isKnownModel(id), `${id} not in catalogue`);
    }
  });

  test('SAFE_FALLBACK_MODEL_ID is in the platform allowlist', () => {
    assert.ok(catalogue.PLATFORM_ALLOWED_MODEL_IDS.includes(catalogue.SAFE_FALLBACK_MODEL_ID));
  });

  test('filterKnownModelIds drops unknowns', () => {
    const out = catalogue.filterKnownModelIds([
      'claude-sonnet-4-6',
      'totally-fake-model',
      'claude-opus-4-7',
      null,
      undefined,
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out.sort(), ['claude-opus-4-7', 'claude-sonnet-4-6']);
  });
});

describe('resolveAllowedModels', () => {
  test('no orgId → platform allowlist', async () => {
    const r = await orgModels.resolveAllowedModels({ orgId: null, hasCustomerKey: false });
    assert.equal(r.source, 'platform');
    assert.deepEqual(r.allowed.sort(), [...catalogue.PLATFORM_ALLOWED_MODEL_IDS].sort());
    assert.equal(r.default, catalogue.SAFE_FALLBACK_MODEL_ID);
  });

  test('org with no allowlist + no customer key → platform fallback', async () => {
    stubOrgRow({ allowed_models: null, default_model: null });
    const r = await orgModels.resolveAllowedModels({ orgId: 'org-1', hasCustomerKey: false });
    assert.equal(r.source, 'platform');
    assert.deepEqual(r.allowed.sort(), [...catalogue.PLATFORM_ALLOWED_MODEL_IDS].sort());
  });

  test('org with no allowlist + customer key → full active Anthropic catalogue (excludes OpenAI/unsupported)', async () => {
    stubOrgRow({ allowed_models: null, default_model: null });
    const r = await orgModels.resolveAllowedModels({ orgId: 'org-1', hasCustomerKey: true });
    assert.equal(r.source, 'byo-default');
    // Only Anthropic + active + supported models — OpenAI entries are
    // catalogue-only until the runtime can route to them.
    const expectedIds = catalogue.KNOWN_MODELS
      .filter((m) => !m.deprecated && !m.unsupported && m.vendor === 'anthropic')
      .map((m) => m.id);
    assert.deepEqual(r.allowed.sort(), expectedIds.sort());
    assert.equal(r.default, catalogue.SAFE_FALLBACK_MODEL_ID);
    // Sanity: no OpenAI slipped in
    assert.ok(!r.allowed.some((id) => id.startsWith('gpt-') || id.startsWith('o4-')));
  });

  test('catalogue includes OpenAI models, all marked unsupported', () => {
    const openaiModels = catalogue.KNOWN_MODELS.filter((m) => m.vendor === 'openai');
    assert.ok(openaiModels.length > 0, 'catalogue should include OpenAI entries');
    for (const m of openaiModels) {
      assert.equal(m.unsupported, true, `${m.id} should be marked unsupported until OpenAI client wires up`);
    }
  });

  test('org with explicit allowlist → that exact list', async () => {
    stubOrgRow({
      allowed_models: ['claude-opus-4-7', 'claude-sonnet-4-6'],
      default_model: 'claude-opus-4-7',
    });
    const r = await orgModels.resolveAllowedModels({ orgId: 'org-1', hasCustomerKey: true });
    assert.equal(r.source, 'org');
    assert.deepEqual(r.allowed, ['claude-opus-4-7', 'claude-sonnet-4-6']);
    assert.equal(r.default, 'claude-opus-4-7');
  });

  test('org allowlist filters out unknown ids; falls back if all are unknown', async () => {
    stubOrgRow({
      allowed_models: ['totally-fake', 'also-fake'],
      default_model: 'totally-fake',
    });
    const r = await orgModels.resolveAllowedModels({ orgId: 'org-1', hasCustomerKey: true });
    // All unknowns → falls back to platform default to avoid locking the org out
    assert.equal(r.source, 'platform');
  });

  test('default falls back to first allowed when stored default is invalid', async () => {
    stubOrgRow({
      allowed_models: ['claude-sonnet-4-6'],
      default_model: 'totally-fake',
    });
    const r = await orgModels.resolveAllowedModels({ orgId: 'org-1', hasCustomerKey: true });
    assert.equal(r.default, 'claude-sonnet-4-6');
  });

  test('Supabase fetch failure → safe platform fallback (no throw)', async () => {
    global.fetch = async () => new Response('boom', { status: 500 });
    const r = await orgModels.resolveAllowedModels({ orgId: 'org-1', hasCustomerKey: false });
    assert.equal(r.source, 'platform');
  });
});

describe('setOrgAllowedModels validation', () => {
  test('rejects non-array allowed (and not null)', async () => {
    const r = await orgModels.setOrgAllowedModels({ orgId: 'org-1', allowed: 'sk', defaultModel: null });
    assert.equal(r.ok, false);
    assert.match(r.error, /array/);
  });

  test('rejects unknown default model id', async () => {
    const r = await orgModels.setOrgAllowedModels({
      orgId: 'org-1',
      allowed: ['claude-sonnet-4-6'],
      defaultModel: 'totally-fake',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /Unknown model/);
  });

  test('rejects default not in allowed list', async () => {
    const r = await orgModels.setOrgAllowedModels({
      orgId: 'org-1',
      allowed: ['claude-sonnet-4-6'],
      defaultModel: 'claude-opus-4-7',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /must be in allowed/);
  });

  test('writes when valid', async () => {
    let patchedBody = null;
    global.fetch = async (url, opts) => {
      patchedBody = opts?.body ? JSON.parse(opts.body) : null;
      return new Response(null, { status: 200 });
    };
    const r = await orgModels.setOrgAllowedModels({
      orgId: 'org-1',
      allowed: ['claude-sonnet-4-6', 'claude-opus-4-7'],
      defaultModel: 'claude-sonnet-4-6',
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.allowed, ['claude-sonnet-4-6', 'claude-opus-4-7']);
    assert.equal(r.default, 'claude-sonnet-4-6');
    assert.deepEqual(patchedBody.allowed_models, ['claude-sonnet-4-6', 'claude-opus-4-7']);
    assert.equal(patchedBody.default_model, 'claude-sonnet-4-6');
  });
});
