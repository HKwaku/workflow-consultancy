/**
 * Unit tests — DiagnosticContext reducer (deal state)
 *
 * Tests the SET_DEAL action and related state transitions.
 * Run with: node --test tests/diagnostic-context.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline the reducer for pure testing (no React dependency) ──────────────
// Mirrors the real diagnosticReducer in DiagnosticContext.jsx

const initialState = {
  currentScreen: 0,
  maxVisitedScreen: 0,
  processData: {},
  completedProcesses: [],
  customDepartments: [],
  moduleId: null,
  diagnosticMode: 'comprehensive',
  authUser: null,
  contact: null,
  dealId: null,
  dealCode: null,
  dealRole: null,
  dealName: null,
  dealParticipants: [],
  teamMode: false,
  auditTrail: [],
};

function diagnosticReducer(state, action) {
  switch (action.type) {
    case 'SET_CURRENT_SCREEN':
      return {
        ...state,
        currentScreen: action.payload,
        maxVisitedScreen: Math.max(state.maxVisitedScreen ?? 0, action.payload),
      };
    case 'SET_MODULE_ID':
      return { ...state, moduleId: action.payload };
    case 'SET_AUTH_USER':
      return { ...state, authUser: action.payload };
    case 'SET_DEAL':
      return {
        ...state,
        dealId: action.payload.dealId || null,
        dealCode: action.payload.dealCode || null,
        dealRole: action.payload.dealRole || null,
        dealName: action.payload.dealName || null,
        dealParticipants: action.payload.dealParticipants || [],
      };
    case 'RESTORE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dispatch(state, action) {
  return diagnosticReducer(state, action);
}

// ── SET_DEAL tests ─────────────────────────────────────────────────────────

describe('SET_DEAL action', () => {
  test('sets all deal fields from a full payload', () => {
    const state = dispatch(initialState, {
      type: 'SET_DEAL',
      payload: {
        dealId: 'deal-001',
        dealCode: 'ABCD1234',
        dealRole: 'platform_company',
        dealName: 'ABC Capital Roll-up',
        dealParticipants: [
          { id: 'p1', role: 'platform_company', companyName: 'ABC Capital' },
          { id: 'p2', role: 'portfolio_company', companyName: 'Target Co. A' },
        ],
      },
    });

    assert.equal(state.dealId, 'deal-001');
    assert.equal(state.dealCode, 'ABCD1234');
    assert.equal(state.dealRole, 'platform_company');
    assert.equal(state.dealName, 'ABC Capital Roll-up');
    assert.equal(state.dealParticipants.length, 2);
    assert.equal(state.dealParticipants[0].role, 'platform_company');
    assert.equal(state.dealParticipants[1].companyName, 'Target Co. A');
  });

  test('defaults dealParticipants to empty array when not provided', () => {
    const state = dispatch(initialState, {
      type: 'SET_DEAL',
      payload: { dealId: 'deal-002', dealCode: 'XY12', dealRole: 'portfolio_company', dealName: 'Test Deal' },
    });
    assert.deepEqual(state.dealParticipants, []);
  });

  test('sets all fields to null when called with empty payload', () => {
    const populated = dispatch(initialState, {
      type: 'SET_DEAL',
      payload: { dealId: 'd1', dealCode: 'C1', dealRole: 'platform_company', dealName: 'Deal' },
    });
    const cleared = dispatch(populated, { type: 'SET_DEAL', payload: {} });

    assert.equal(cleared.dealId, null);
    assert.equal(cleared.dealCode, null);
    assert.equal(cleared.dealRole, null);
    assert.equal(cleared.dealName, null);
    assert.deepEqual(cleared.dealParticipants, []);
  });

  test('does not mutate other state fields', () => {
    const withModule = dispatch(initialState, { type: 'SET_MODULE_ID', payload: 'pe' });
    const withDeal = dispatch(withModule, {
      type: 'SET_DEAL',
      payload: { dealId: 'd1', dealCode: 'C1', dealRole: 'platform_company', dealName: 'Deal' },
    });

    assert.equal(withDeal.moduleId, 'pe');
    assert.equal(withDeal.currentScreen, 0);
    assert.deepEqual(withDeal.completedProcesses, []);
  });

  test('portfolio_company role is stored correctly', () => {
    const state = dispatch(initialState, {
      type: 'SET_DEAL',
      payload: { dealId: 'd2', dealCode: 'PF01', dealRole: 'portfolio_company', dealName: 'Fund Deal' },
    });
    assert.equal(state.dealRole, 'portfolio_company');
  });

  test('RESTORE action restores deal state from persisted data', () => {
    const restored = dispatch(initialState, {
      type: 'RESTORE',
      payload: {
        dealId: 'restored-deal',
        dealCode: 'REST01',
        dealRole: 'platform_company',
        dealName: 'Restored Deal',
        dealParticipants: [{ id: 'p1', role: 'platform_company', companyName: 'Restored Co' }],
        currentScreen: 2,
        moduleId: 'pe',
      },
    });

    assert.equal(restored.dealId, 'restored-deal');
    assert.equal(restored.dealCode, 'REST01');
    assert.equal(restored.dealName, 'Restored Deal');
    assert.equal(restored.dealParticipants.length, 1);
    assert.equal(restored.currentScreen, 2);
    assert.equal(restored.moduleId, 'pe');
  });

  test('RESTORE with missing deal fields defaults to null', () => {
    const restored = dispatch(initialState, {
      type: 'RESTORE',
      payload: { currentScreen: 1, moduleId: 'pe' },
    });
    // Fields missing from restore payload fall through to initialState defaults
    // (state spread means they retain whatever was already there — null from initialState)
    assert.equal(restored.dealId, null);
    assert.equal(restored.dealCode, null);
  });
});

// ── needsPEDealSetup logic tests ───────────────────────────────────────────
//
// This mirrors the gate condition in DiagnosticClient:
//   gateCompleted && moduleId === 'pe' && !dealId && !participantToken && !edit && !reaudit

describe('needsPEDealSetup gate logic', () => {
  function evalGate({ moduleId, dealId, participantToken, urlEdit, urlReaudit, gateCompleted = true }) {
    return (
      gateCompleted &&
      moduleId === 'pe' &&
      !dealId &&
      !participantToken &&
      !urlEdit &&
      !urlReaudit
    );
  }

  test('returns true for a fresh PE audit with no deal', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: null, participantToken: null }), true);
  });

  test('returns false when a dealId is already set', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: 'deal-001', participantToken: null }), false);
  });

  test('returns false when joining via participant token', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: null, participantToken: 'TOKEN_ABC' }), false);
  });

  test('returns false for non-PE modules', () => {
    assert.equal(evalGate({ moduleId: 'ma',          dealId: null, participantToken: null }), false);
    assert.equal(evalGate({ moduleId: 'scaling',     dealId: null, participantToken: null }), false);
    assert.equal(evalGate({ moduleId: 'high-risk-ops', dealId: null, participantToken: null }), false);
    assert.equal(evalGate({ moduleId: null,          dealId: null, participantToken: null }), false);
  });

  test('returns false when gate has not been completed', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: null, participantToken: null, gateCompleted: false }), false);
  });

  test('returns false when in an edit flow', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: null, participantToken: null, urlEdit: 'report-123' }), false);
  });

  test('returns false when in a re-audit flow', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: null, participantToken: null, urlReaudit: 'report-abc' }), false);
  });

  test('returns true even with undefined optionals', () => {
    assert.equal(evalGate({ moduleId: 'pe', dealId: undefined, participantToken: undefined }), true);
  });
});

// ── Deal redirect logic in Screen6Complete ─────────────────────────────────

describe('Screen6 PE redirect logic', () => {
  function getPendingUrl({ effectiveModuleId, dealId, processDealId, reportUrl, storedInSupabase }) {
    const effectiveDealId = dealId || processDealId;
    if (effectiveModuleId === 'pe' && effectiveDealId) {
      return `/deals/${effectiveDealId}`;
    }
    if (reportUrl) return reportUrl;
    if (!storedInSupabase) throw new Error('Report not saved');
    return null;
  }

  test('PE deal redirects to /deals/[id]', () => {
    const url = getPendingUrl({ effectiveModuleId: 'pe', dealId: 'deal-abc', reportUrl: '/report?id=r1', storedInSupabase: true });
    assert.equal(url, '/deals/deal-abc');
  });

  test('PE deal uses processData.dealId as fallback', () => {
    const url = getPendingUrl({ effectiveModuleId: 'pe', dealId: null, processDealId: 'deal-from-process', reportUrl: '/report?id=r1', storedInSupabase: true });
    assert.equal(url, '/deals/deal-from-process');
  });

  test('non-PE goes to report URL', () => {
    const url = getPendingUrl({ effectiveModuleId: 'scaling', dealId: null, reportUrl: '/report?id=r1', storedInSupabase: true });
    assert.equal(url, '/report?id=r1');
  });

  test('PE with no dealId falls back to report URL', () => {
    const url = getPendingUrl({ effectiveModuleId: 'pe', dealId: null, processDealId: null, reportUrl: '/report?id=r1', storedInSupabase: true });
    assert.equal(url, '/report?id=r1');
  });

  test('M&A module goes to report URL (not deal redirect)', () => {
    const url = getPendingUrl({ effectiveModuleId: 'ma', dealId: 'deal-ma-001', reportUrl: '/report?id=r2', storedInSupabase: true });
    assert.equal(url, '/report?id=r2');
  });
});
