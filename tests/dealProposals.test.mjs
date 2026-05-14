/**
 * Tests for lib/changes/dealProposals.js
 *
 * Run: node --test tests/dealProposals.test.mjs
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;
let mod;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  mod = await import('../lib/changes/dealProposals.js');
});

afterEach(() => { global.fetch = realFetch; });

describe('trackedProposalKinds', () => {
  test('lists the live mutating proposal verbs', () => {
    const kinds = mod.trackedProposalKinds();
    const expected = [
      'invite_participant',
      'reprocess_document', 'link_participant_report',
      'undo_link_participant_report',
    ].sort();
    assert.deepEqual(kinds.slice().sort(), expected);
    // Removed in living-workspace migration: run_analysis / generate_report
    // / export_pptx / finding_review / undo_finding_review (deal_analyses +
    // per-analysis review snapshots are gone).
    assert.equal(kinds.includes('run_analysis'), false);
    assert.equal(kinds.includes('generate_report'), false);
    assert.equal(kinds.includes('export_pptx'), false);
    assert.equal(kinds.includes('finding_review'), false);
    assert.equal(kinds.includes('undo_finding_review'), false);
    // upload_document: non-mutating navigation hint, never persisted.
    assert.equal(kinds.includes('upload_document'), false);
  });
});

describe('recordDealProposal', () => {
  test('inserts a row at state=proposed with deal_id, agent metadata, and chat actor email', async () => {
    let captured;
    global.fetch = async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response(JSON.stringify([{ id: 'change_xyz' }]), { status: 201 });
    };

    const id = await mod.recordDealProposal({
      ctx: {
        dealId: 'deal_1',
        dealAccessVerified: true,
        session: { email: 'analyst@example.com' },
      },
      sseKind: 'invite_participant',
      subject_ref: { role: 'acquirer', companyName: 'Acme' },
      rationale: 'add the acquirer slot',
      evidence_refs: [],
    });

    assert.equal(id, 'change_xyz');
    assert.match(captured.url, /\/changes/);
    const [row] = captured.body;
    assert.equal(row.subject_type, 'participant');
    assert.equal(row.kind, 'added');
    assert.equal(row.state, 'proposed');
    assert.equal(row.deal_id, 'deal_1');
    assert.equal(row.actor_kind, 'agent');
    assert.equal(row.agent_name, 'chat');
    assert.equal(row.actor_email, 'analyst@example.com');
    assert.equal(row.rationale, 'add the acquirer slot');
    assert.deepEqual(row.subject_ref, { role: 'acquirer', companyName: 'Acme' });
  });

  test('refuses when ctx has no dealId', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };

    const id = await mod.recordDealProposal({
      ctx: { dealAccessVerified: true },
      sseKind: 'invite_participant',
      subject_ref: { role: 'acquirer', companyName: 'Acme' },
    });
    assert.equal(id, null);
    assert.equal(called, false);
  });

  test('refuses when ctx has dealId but dealAccessVerified is false', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };

    const id = await mod.recordDealProposal({
      ctx: { dealId: 'deal_1', dealAccessVerified: false },
      sseKind: 'invite_participant',
      subject_ref: { role: 'acquirer', companyName: 'Acme' },
    });
    assert.equal(id, null);
    assert.equal(called, false);
  });

  test('refuses unknown sseKind without making a network call', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };

    const id = await mod.recordDealProposal({
      ctx: { dealId: 'deal_1', dealAccessVerified: true },
      sseKind: 'launch_missile',
      subject_ref: {},
    });
    assert.equal(id, null);
    assert.equal(called, false);
  });

  test('maps undo_link_participant_report to kind=reverted', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 'change_undo' }]), { status: 201 });
    };

    await mod.recordDealProposal({
      ctx: { dealId: 'd1', dealAccessVerified: true, session: {} },
      sseKind: 'undo_link_participant_report',
      subject_ref: { participantId: 'p1' },
    });
    assert.equal(captured[0].kind, 'reverted');
  });

  test('returns null when the insert returns no id (storage offline)', async () => {
    global.fetch = async () => new Response('boom', { status: 500 });
    const id = await mod.recordDealProposal({
      ctx: { dealId: 'd1', dealAccessVerified: true, session: {} },
      sseKind: 'invite_participant',
      subject_ref: { role: 'acquirer', companyName: 'Acme' },
    });
    assert.equal(id, null);
  });
});
