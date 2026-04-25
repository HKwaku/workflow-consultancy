/**
 * E2E tests - PE Roll-up diagnostic flow
 *
 * Covers the rule: PE diagnostics must start with a deal (platform + targets).
 * API calls are intercepted so no real backend is required beyond the Next.js
 * dev server being up.
 *
 * Run: npx playwright test tests/e2e/pe-rollup.spec.js
 */

import { test, expect } from '@playwright/test';

// ── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_STORAGE_KEY = 'sb-pmtmxtzuuljoslehwzcz-auth-token';
const SUPABASE_URL = 'https://pmtmxtzuuljoslehwzcz.supabase.co';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Seed a fake Supabase session so useAuth() returns a valid accessToken.
 * Must be called before page.goto() so the script runs before React hydrates.
 */
async function seedAuthSession(page, overrides = {}) {
  const email = overrides.email || 'jane@example.com';
  const now = Math.floor(Date.now() / 1000);
  const fakeSession = {
    access_token: 'e2e-access-token',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: now + 86400,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: 'e2e-user-123',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: '2024-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: overrides.name || 'Jane Smith' },
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    },
  };

  // Intercept Supabase auth network calls to prevent token-refresh errors
  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeSession),
    });
  });

  // Seed localStorage before any page scripts run
  await page.addInitScript(([key, session]) => {
    localStorage.setItem(key, JSON.stringify(session));
  }, [SUPABASE_STORAGE_KEY, fakeSession]);
}

/** Fill the audit gate and submit with PE segment selected */
async function fillAuditGate(page, overrides = {}) {
  const { name = 'Jane Smith', email = 'jane@example.com', company = 'Acme Capital' } = overrides;
  await page.fill('#audit-gate-name', name);
  await page.fill('#audit-gate-email', email);
  if (company) await page.fill('#audit-gate-company', company);
  // Select PE segment
  await page.click('.audit-seg-btn--amber');
  await page.click('button[type="submit"]');
}

/** Stub the /api/deals POST to return a successful deal response */
async function stubDealCreate(page, overrides = {}) {
  const baseUrl = 'http://localhost:3000';
  await page.route('**/api/deals', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        deal: {
          id: overrides.dealId ?? 'deal-test-001',
          dealCode: overrides.dealCode ?? 'PETEST01',
          type: 'pe_rollup',
          name: overrides.dealName ?? 'Test Roll-up',
          processName: overrides.processName ?? null,
          status: 'collecting',
          createdAt: new Date().toISOString(),
        },
        participants: [
          {
            id: 'part-001',
            role: 'platform_company',
            companyName: 'Acme Capital',
            participantEmail: null,
            participantName: null,
            status: 'pending',
            inviteUrl: `${baseUrl}/process-audit?participant=PLATFORM_TOKEN`,
          },
          {
            id: 'part-002',
            role: 'portfolio_company',
            companyName: 'Target Co. A',
            participantEmail: null,
            participantName: null,
            status: 'pending',
            inviteUrl: `${baseUrl}/process-audit?participant=TARGET_TOKEN_A`,
          },
        ],
      }),
    });
  });
}

/** Stub the /api/deals/resolve endpoint for participant token resolution */
async function stubParticipantResolve(page, token, response) {
  await page.route(`**/api/deals/resolve?participant=${token}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
  // Also handle encoded form
  await page.route(`**/api/deals/resolve**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('participant') === token) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Drive the PE deal setup chat to completion.
 * Requires auth to be seeded first so the chat form is visible.
 */
async function completeChatSetup(page, opts = {}) {
  const {
    dealName = 'ABC Capital 2024 Roll-up',
    useDefaultPlatform = true,   // true = confirm the pre-filled company
    platformCompany = 'New Corp', // used if useDefaultPlatform is false
    skipProcess = true,
    targets = [{ companyName: 'Target Co. A', skipEmail: true }],
  } = opts;

  // ── Deal name ────────────────────────────────────────────────────────────
  await page.waitForSelector('.guided-chat-input');
  await page.fill('.guided-chat-input', dealName);
  await page.keyboard.press('Enter');

  // ── Platform company ─────────────────────────────────────────────────────
  const confirmChip = page.locator('.guided-chat-chip:has-text("Yes")').first();
  if (await confirmChip.isVisible({ timeout: 3000 }).catch(() => false)) {
    if (useDefaultPlatform) {
      await confirmChip.click();
    } else {
      await page.locator('.guided-chat-chip:has-text("Change it")').click();
      await page.fill('.guided-chat-input', platformCompany);
      await page.keyboard.press('Enter');
    }
  } else {
    // No confirmation chip - directly entering platform company
    await page.fill('.guided-chat-input', platformCompany);
    await page.keyboard.press('Enter');
  }

  // ── Process name ─────────────────────────────────────────────────────────
  if (skipProcess) {
    await page.locator('.guided-chat-chip:has-text("Skip")').first().click();
  } else {
    await page.fill('.guided-chat-input', opts.processName || 'Invoice Approval');
    await page.keyboard.press('Enter');
  }

  // ── Targets ──────────────────────────────────────────────────────────────
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    await page.fill('.guided-chat-input', t.companyName);
    await page.keyboard.press('Enter');

    // Email
    if (t.skipEmail !== false) {
      await page.locator('.guided-chat-chip:has-text("Skip")').first().click();
    } else {
      await page.fill('.guided-chat-input', t.email || '');
      await page.keyboard.press('Enter');
    }

    // Add more or continue
    if (i < targets.length - 1) {
      await page.locator('.guided-chat-chip:has-text("Add another")').click();
    }
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  await page.locator('.guided-chat-chip:has-text("Done")').click();
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('PE Roll-up - deal setup gate', () => {
  test.beforeEach(async ({ page }) => {
    // Seed auth and clear saved progress
    await seedAuthSession(page);
    await page.goto('/process-audit');
    await page.evaluate(() => localStorage.removeItem('processDiagnosticProgress'));
    await page.reload();
  });

  // ── 1. Deal setup appears after PE gate ────────────────────────────────────

  test('shows deal setup chat after selecting PE segment', async ({ page }) => {
    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);

    // Should land on PE deal setup chat inside the diagnostic shell
    await expect(page.locator('.diagnostic-shell')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.pe-deal-badge')).toBeVisible({ timeout: 4000 });
    // Chat greeting from Reina should be visible
    await expect(page.locator('.guided-chat-messages .s7-msg-bubble').first()).toContainText("Let's set up your PE roll-up");
  });

  test('deal setup is NOT shown for non-PE segments', async ({ page }) => {
    await page.waitForSelector('.audit-gate-screen');
    // Fill gate with Scaling segment instead
    await page.fill('#audit-gate-name', 'Jane Smith');
    await page.fill('#audit-gate-email', 'jane@example.com');
    await page.click('.audit-seg-btn--teal'); // Scaling
    await page.click('button[type="submit"]');

    // Should go straight to screen 0, not PE deal setup (no .pe-deal-badge)
    await expect(page.locator('.pe-deal-badge')).not.toBeVisible({ timeout: 4000 });
  });

  // ── 2. Unauthenticated user sees sign-in gate ────────────────────────────

  test('shows sign-in gate when user is not authenticated', async ({ page }) => {
    // This test does NOT seed auth - navigates fresh without session
    // Re-create page without the seeded session by navigating directly
    // (beforeEach already seeded, so we clear it)
    await page.evaluate((key) => localStorage.removeItem(key), SUPABASE_STORAGE_KEY);
    await page.reload();

    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);

    // Sign-in gate is now rendered as chat bubbles inside the diagnostic shell
    await expect(page.locator('.pe-deal-signin-screen')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.pe-deal-signin-screen .guided-chat-chip')).toContainText('Sign in');
  });

  // ── 3. Chat interaction - collect data ───────────────────────────────────

  test('chat advances through deal name to platform confirmation', async ({ page }) => {
    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page, { company: 'Orion Capital' });
    await page.waitForSelector('.guided-chat-messages');

    // Type deal name
    await page.fill('.guided-chat-input', 'My Roll-up');
    await page.keyboard.press('Enter');

    // Bot should ask to confirm 'Orion Capital'
    await expect(page.locator('.guided-chat-messages .s7-msg-bubble').last()).toContainText('Orion Capital');
    // Confirmation chips should be visible
    await expect(page.locator('.guided-chat-chip:has-text("Yes")')).toBeVisible();
    await expect(page.locator('.guided-chat-chip:has-text("Change it")')).toBeVisible();
  });

  test('platform company name appears as confirmation message when pre-filled', async ({ page }) => {
    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page, { company: 'Orion Capital' });
    await page.waitForSelector('.guided-chat-messages');

    await page.fill('.guided-chat-input', 'My Deal');
    await page.keyboard.press('Enter');

    // Bot message should contain "Orion Capital" as the confirmation
    await expect(
      page.locator('.guided-chat-messages .s7-msg-assistant .s7-msg-bubble:has-text("Orion Capital")')
    ).toBeVisible({ timeout: 4000 });
  });

  test('can add multiple target companies via chat', async ({ page }) => {
    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);
    await page.waitForSelector('.guided-chat-messages');

    // Drive through to first target
    await page.fill('.guided-chat-input', 'My Roll-up');
    await page.keyboard.press('Enter');
    await page.locator('.guided-chat-chip:has-text("Yes")').first().click();
    await page.locator('.guided-chat-chip:has-text("Skip")').first().click();

    // Enter first target
    await page.fill('.guided-chat-input', 'Alpha Corp');
    await page.keyboard.press('Enter');
    await page.locator('.guided-chat-chip:has-text("Skip")').first().click();

    // Add another
    await page.locator('.guided-chat-chip:has-text("Add another")').click();
    await expect(page.locator('.guided-chat-input')).toBeVisible();

    // Enter second target
    await page.fill('.guided-chat-input', 'Beta Ltd');
    await page.keyboard.press('Enter');
    await page.locator('.guided-chat-chip:has-text("Skip")').first().click();

    // Done - summary should mention both companies
    await page.locator('.guided-chat-chip:has-text("Done")').click();
    await expect(page.locator('.guided-chat-messages .s7-msg-bubble:has-text("Alpha Corp")')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.guided-chat-messages .s7-msg-bubble:has-text("Beta Ltd")')).toBeVisible({ timeout: 4000 });
  });

  // ── 4. Successful deal creation → proceeds to screen 0 ──────────────────

  test('creates deal and moves to diagnostic screen 0 on success', async ({ page }) => {
    await stubDealCreate(page);

    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);
    await page.waitForSelector('.guided-chat-messages');

    await completeChatSetup(page);

    // Confirm chip - create the deal
    await page.locator('.guided-chat-cta-chip:has-text("Create roll-up")').click();

    // Should now be on the diagnostic shell - PE badge is gone
    await expect(page.locator('.pe-deal-badge')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.diagnostic-shell')).toBeVisible({ timeout: 8000 });
  });

  test('submit button shows loading state during deal creation', async ({ page }) => {
    // Slow stub to observe the loading state
    await page.route('**/api/deals', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          deal: { id: 'd1', dealCode: 'TEST', type: 'pe_rollup', name: 'My Deal', status: 'collecting', createdAt: new Date().toISOString() },
          participants: [{ id: 'p1', role: 'platform_company', companyName: 'Acme Capital', status: 'pending', inviteUrl: 'http://localhost:3000/process-audit?participant=TOK' }],
        }),
      });
    });

    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);
    await page.waitForSelector('.guided-chat-messages');

    await completeChatSetup(page);
    await page.locator('.guided-chat-cta-chip').click();

    // Button should show loading text
    await expect(page.locator('.guided-chat-cta-chip')).toContainText('Creating roll-up');
  });

  // ── 5. Start over resets chat ────────────────────────────────────────────

  test('start over resets the chat back to deal name question', async ({ page }) => {
    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);
    await page.waitForSelector('.guided-chat-messages');

    // Drive through to confirmation
    await completeChatSetup(page);

    // Start over chip
    await page.locator('.guided-chat-chip:has-text("Start over")').click();

    // Should restart - ask for deal name again
    await expect(page.locator('.guided-chat-input')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.guided-chat-messages .s7-msg-bubble').last()).toContainText("What's the name of this deal");
  });

  // ── 6. Auth error handling ────────────────────────────────────────────────

  test('shows error message on deal creation failure', async ({ page }) => {
    await page.route('**/api/deals', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Database error.' }),
      });
    });

    await page.waitForSelector('.audit-gate-screen');
    await fillAuditGate(page);
    await page.waitForSelector('.guided-chat-messages');

    await completeChatSetup(page);
    await page.locator('.guided-chat-cta-chip').click();

    await expect(page.locator('.pe-deal-error')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.pe-deal-error')).toContainText('Database error');
  });

  // ── 7. Portfolio company via invite token skips deal setup ────────────────

  test('portfolio company joining via invite token bypasses deal setup', async ({ page }) => {
    // Stub the participant resolve endpoint
    await stubParticipantResolve(page, 'INVITE_TOKEN_123', {
      dealId: 'deal-001',
      dealCode: 'ABCD1234',
      dealType: 'pe_rollup',
      dealName: 'Test Roll-up',
      processName: 'Invoice Approval',
      companyName: 'Target Co. A',
      role: 'portfolio_company',
      participantName: null,
    });

    // Visit with participant token
    await page.goto('/process-audit?participant=INVITE_TOKEN_123');
    await page.evaluate(() => localStorage.removeItem('processDiagnosticProgress'));
    await page.reload();
    await page.goto('/process-audit?participant=INVITE_TOKEN_123');

    // The audit gate should show the deal context (invited state)
    await page.waitForSelector('.audit-gate-screen', { timeout: 8000 });
    await expect(page.locator('.audit-gate-hero-title')).toContainText("You've been invited");
    await expect(page.locator('.audit-gate-hero-lede')).toContainText('Target Co. A');

    // Fill gate and submit
    await page.fill('#audit-gate-name', 'Bob Jones');
    await page.fill('#audit-gate-email', 'bob@targetco.com');
    await page.click('button[type="submit"]');

    // Should go directly to diagnostic shell (screen 0) - PE badge not present
    await expect(page.locator('.pe-deal-badge')).not.toBeVisible({ timeout: 6000 });
    await expect(page.locator('.diagnostic-shell')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('PE Roll-up - Screen 6 completion redirect', () => {
  /**
   * These tests validate that after a PE participant submits their process,
   * they are sent to the deal dashboard (/deals/[id]) rather than /report/[id].
   *
   * They stub all API calls needed to reach Screen 6.
   */

  async function reachScreen6AsPlatform(page) {
    // Stub send-diagnostic-report
    await page.route('**/api/send-diagnostic-report', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reportId: 'report-sc6-001',
          reportUrl: 'http://localhost:3000/report?id=report-sc6-001',
          storedInSupabase: true,
        }),
      });
    });

    // Seed localStorage with PE state at screen 6 (Screen6Complete)
    await page.goto('/process-audit');
    await page.evaluate(() => {
      localStorage.setItem('processDiagnosticProgress', JSON.stringify({
        timestamp: new Date().toISOString(),
        currentScreen: 6,
        moduleId: 'pe',
        dealId: 'deal-sc6-test',
        dealCode: 'SC6TEST',
        dealRole: 'platform_company',
        dealName: 'Test Roll-up',
        dealParticipants: [
          { id: 'p1', role: 'platform_company', companyName: 'Acme Capital', inviteUrl: 'http://localhost:3000/process-audit?participant=PLATFORM_TOKEN' },
          { id: 'p2', role: 'portfolio_company', companyName: 'Target A', inviteUrl: 'http://localhost:3000/process-audit?participant=TARGET_TOKEN' },
        ],
        authUser: { name: 'Jane Smith', email: 'jane@example.com', company: 'Acme Capital', title: '' },
        contact: { name: 'Jane Smith', email: 'jane@example.com', company: 'Acme Capital', title: '' },
      }));
    });
    await page.reload();

    // The gate appears first. Fill it with a NON-PE segment so the PE deal setup
    // interstitial doesn't block the resume toast. The saved state (restored via
    // Continue) will override moduleId back to 'pe' with a valid dealId.
    await page.waitForSelector('.audit-gate-screen');
    await page.fill('#audit-gate-name', 'Jane Smith');
    await page.fill('#audit-gate-email', 'jane@example.com');
    await page.click('.audit-seg-btn--teal');   // Scaling Business (non-PE)
    await page.click('button[type="submit"]');

    // Resume toast now shows - click Continue to restore the saved PE state
    await page.waitForSelector('.resume-toast', { timeout: 10000 });
    await page.click('.resume-toast-btn-primary');
    await page.waitForSelector('.diagnostic-shell');
  }

  test('PE platform company is redirected to deal dashboard after submission', async ({ page }) => {
    await reachScreen6AsPlatform(page);  // lands on .diagnostic-shell at screen 6

    // Wait for the PE done screen
    await expect(page.locator('.sc6-pe-deal-card')).toBeVisible({ timeout: 15000 });

    // Should show deal redirect, not individual report button
    await expect(page.locator('button:has-text("Go to deal dashboard")')).toBeVisible();
    await expect(page.locator('button:has-text("View your report")')).not.toBeVisible();

    // Should show target invite section
    await expect(page.locator('.sc6-pe-targets')).toBeVisible();
    await expect(page.locator('.sc6-pe-target-name')).toContainText('Target A');
  });
});
