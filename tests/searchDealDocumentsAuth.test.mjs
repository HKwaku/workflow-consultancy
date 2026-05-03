/**
 * Regression test for the search_deal_documents auth-bypass fix.
 *
 * Bug summary:
 *   The search_deal_documents chat tool calls Postgres via the service-role key,
 *   which bypasses RLS. The original implementation only checked that
 *   ctx.dealId was a UUID, so an authenticated user could read another user's
 *   deal documents by passing the victim's deal UUID in the chat request body.
 *
 * Fix:
 *   1. /api/diagnostic-chat resolves deal access via resolveDealAccess() and
 *      ONLY passes dealId + dealAccessVerified=true if the user is owner /
 *      collaborator / participant.
 *   2. The tool executor refuses unless ctx.dealAccessVerified is true.
 *
 * This test exercises layer #2 — the in-process refusal — by calling the
 * executor directly with crafted ctx objects.
 *
 * Run: node --test tests/searchDealDocumentsAuth.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { __executeToolForTests as executeTool } from '../lib/agents/chat/graph.js';

const REFUSAL_PATTERN = /No deal context|access/i;

describe('search_deal_documents — auth gate', () => {
  test('refuses when ctx has no dealId at all', async () => {
    const result = await executeTool('search_deal_documents', { query: 'anything' }, {
      session: { email: 'a@b.com', userId: 'u1' },
    });
    assert.match(result, REFUSAL_PATTERN);
  });

  test('refuses when ctx has dealId but dealAccessVerified is false', async () => {
    // This is the exact attack shape: a user passing a stranger's dealId.
    const result = await executeTool('search_deal_documents', { query: 'anything' }, {
      session: { email: 'attacker@evil.com', userId: 'u-attacker' },
      dealId: '00000000-0000-0000-0000-000000000000',  // some other user's deal
      dealAccessVerified: false,
    });
    assert.match(result, REFUSAL_PATTERN);
  });

  test('refuses when ctx has dealId but dealAccessVerified is missing', async () => {
    // Defense in depth: a code path that forgets the flag must NOT be treated
    // as authorised. (truthy check, not == undefined.)
    const result = await executeTool('search_deal_documents', { query: 'anything' }, {
      session: { email: 'a@b.com', userId: 'u1' },
      dealId: '11111111-1111-1111-1111-111111111111',
      // dealAccessVerified intentionally omitted
    });
    assert.match(result, REFUSAL_PATTERN);
  });

  test('refuses when dealAccessVerified is true but dealId is falsy', async () => {
    // Belt-and-braces: the flag without a dealId is still a refusal.
    const result = await executeTool('search_deal_documents', { query: 'anything' }, {
      session: { email: 'a@b.com', userId: 'u1' },
      dealId: null,
      dealAccessVerified: true,
    });
    assert.match(result, REFUSAL_PATTERN);
  });

  test('refuses when ctx is empty', async () => {
    const result = await executeTool('search_deal_documents', { query: 'anything' }, {});
    assert.match(result, REFUSAL_PATTERN);
  });

  // We don't test the passing case here because that requires a live Supabase
  // connection. The ctx flag plumbing is the security boundary; the
  // happy-path RPC call is exercised by integration tests against staging.
});
