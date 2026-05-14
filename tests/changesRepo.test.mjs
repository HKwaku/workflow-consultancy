/**
 * Tests for lib/changes/repo.js
 *
 * Run: node --test tests/changesRepo.test.mjs
 *
 * Stubs global fetch for write paths. The adapter (`changesFromRedesign`) is
 * pure and tested without fetch.
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;
let repo;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  repo = await import('../lib/changes/repo.js');
});

afterEach(() => { global.fetch = realFetch; });

/* ── recordChanges (fetch stubbed) ──────────────────────────────── */

describe('recordChanges', () => {
  test('drops rows missing both report_id and deal_id, posts the rest', async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body && JSON.parse(init.body) });
      return new Response(JSON.stringify([{ id: 'change_1' }]), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await repo.recordChanges([
      { subject_type: 'process_step', subject_ref: { stepName: 'A' }, kind: 'removed', report_id: 'r1' },
      { subject_type: 'process_step', subject_ref: { stepName: 'B' }, kind: 'added' /* no scope */ },
    ]);

    assert.equal(result.written, 1);
    assert.equal(result.errors, 1);
    assert.equal(result.ids.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.length, 1);
    assert.equal(calls[0].body[0].subject_ref.stepName, 'A');
  });

  test('clamps confidence into [0, 1]', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 'x' }]), { status: 201 });
    };

    await repo.recordChanges({
      subject_type: 'deal_finding', subject_ref: { finding_key: 'k' },
      kind: 'added', deal_id: 'd1', confidence: 1.5,
    });
    assert.equal(captured[0].confidence, 1);

    await repo.recordChanges({
      subject_type: 'deal_finding', subject_ref: { finding_key: 'k' },
      kind: 'added', deal_id: 'd1', confidence: -0.2,
    });
    assert.equal(captured[0].confidence, 0);
  });
});

/* ── transitionChangesForRedesign (fetch stubbed) ──────────────── */

describe('recordOutcome', () => {
  test('rejects unknown source without making a network call', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    const r = await repo.recordOutcome({
      change_id: 'c1', metric: 'cycle_time_minutes', source: 'magic',
    });
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });

  test('rejects empty metric or change_id', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    assert.equal((await repo.recordOutcome({ change_id: '', metric: 'm', source: 'manual' })).ok, false);
    assert.equal((await repo.recordOutcome({ change_id: 'c', metric: '',  source: 'manual' })).ok, false);
    assert.equal(called, false);
  });

  test('POSTs the outcome and opportunistically PATCHes the change to measured', async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body && JSON.parse(init.body) });
      return new Response('{}', { status: init?.method === 'PATCH' ? 200 : 201 });
    };
    const r = await repo.recordOutcome({
      change_id: 'c1',
      metric: 'cycle_time_minutes',
      unit: 'minutes',
      value_before: 240,
      value_after: 90,
      source: 'manual',
    });
    assert.equal(r.ok, true);
    // First call: POST /change_outcomes
    assert.match(calls[0].url, /change_outcomes/);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body.metric, 'cycle_time_minutes');
    assert.equal(calls[0].body.value_before, 240);
    // Second call: PATCH the change to measured
    assert.match(calls[1].url, /\/changes\?id=eq\.c1/);
    assert.equal(calls[1].method, 'PATCH');
    assert.equal(calls[1].body.state, 'measured');
    assert.ok(calls[1].body.measured_at);
  });
});

describe('transitionChangesForRedesign (post living-workspace migration)', () => {
  test('is a no-op stub: returns {ok:true, updated:0} with no network call', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };

    const result = await repo.transitionChangesForRedesign({
      redesignId: 'rd_abc',
      fromState: 'proposed',
      toState: 'applied',
      actor_email: 'person@example.com',
    });

    assert.equal(result.ok, true);
    assert.equal(result.updated, 0);
    assert.equal(called, false);
  });

  test('still a no-op for any state combination — report_redesigns table no longer exists', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };

    const r = await repo.transitionChangesForRedesign({
      redesignId: 'rd_abc', fromState: 'applied', toState: 'proposed',
    });
    assert.equal(r.ok, true);
    assert.equal(r.updated, 0);
    assert.equal(called, false);
  });
});
