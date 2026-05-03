'use client';

/**
 * UsageAnalyticsPanel — admin-facing token consumption + budget snapshot.
 *
 * Visual design: stat tile row, budget gauge card, segmented filters,
 * SVG area chart for time series, top-N share bars for vendor/surface.
 * Styles in app/portal/portal-byo.css; chart in components/portal/AreaChart.jsx.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import AreaChart from '@/components/portal/AreaChart';
import './portal-byo.css';

const PERIODS = [
  { id: '7d',  label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'mtd', label: 'Month to date' },
];

const GROUP_BYS = [
  { id: 'day',     label: 'Over time' },
  { id: 'surface', label: 'By feature' },
  { id: 'model',   label: 'By model' },
  { id: 'vendor',  label: 'By vendor' },
];

const PERIOD_LABEL = Object.fromEntries(PERIODS.map((p) => [p.id, p.label]));

function fmtTokens(n) {
  if (!n && n !== 0) return '–';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000)    return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtCount(n) {
  if (!n && n !== 0) return '–';
  return n.toLocaleString();
}

function pctOfMax(value, max) {
  if (!max) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export default function UsageAnalyticsPanel({ orgId, accessToken }) {
  const [period, setPeriod]   = useState('30d');
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  const load = useCallback(async () => {
    if (!orgId || !accessToken) return;
    setLoading(true); setErr(null);
    try {
      const resp = await apiFetch(
        `/api/organizations/${orgId}/usage?period=${period}&groupBy=${groupBy}`,
        {}, accessToken,
      );
      const json = await resp.json();
      if (resp.ok) setData(json);
      else setErr(json.error || 'Failed to load usage.');
    } catch { setErr('Network error loading usage.'); }
    finally { setLoading(false); }
  }, [orgId, accessToken, period, groupBy]);

  useEffect(() => { load(); }, [load]);

  // Budget tier colour
  const budgetTier = useMemo(() => {
    const b = data?.budget;
    if (!b?.monthly_token_budget) return null;
    const pct = b.tokens_consumed_this_month / b.monthly_token_budget;
    if (pct >= 1) return 'danger';
    if (pct >= 0.8) return 'danger';
    if (pct >= 0.5) return 'warn';
    return 'ok';
  }, [data]);

  const budgetPct = useMemo(() => {
    const b = data?.budget;
    if (!b?.monthly_token_budget) return 0;
    return Math.min(100, Math.round((b.tokens_consumed_this_month / b.monthly_token_budget) * 100));
  }, [data]);

  const showAreaChart = groupBy === 'day';
  const topListMax = useMemo(() => {
    if (!data?.buckets?.length) return 0;
    return Math.max(...data.buckets.map((b) => b.total));
  }, [data]);

  return (
    <section className="byo-section">
      <header className="byo-header">
        <div className="byo-header-titleblock">
          <h2>AI usage analytics</h2>
          <p className="byo-header-blurb">
            Token consumption across every LLM-backed surface — chat, deal analysis, embeddings, exports. Recorded whether you're on a customer key or our platform key.
          </p>
        </div>
      </header>

      {err && <div className="byo-banner byo-banner--error">⚠ {err}</div>}

      {/* Filters */}
      <div className="byo-filters">
        <div>
          <span className="byo-segmented-label">Period</span>
          <div className="byo-segmented" role="radiogroup" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.id} type="button" role="radio"
                aria-checked={period === p.id}
                className="byo-segmented-btn"
                onClick={() => setPeriod(p.id)}
              >{p.label}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="byo-segmented-label">View</span>
          <div className="byo-segmented" role="radiogroup" aria-label="Group by">
            {GROUP_BYS.map((g) => (
              <button
                key={g.id} type="button" role="radio"
                aria-checked={groupBy === g.id}
                className="byo-segmented-btn"
                onClick={() => setGroupBy(g.id)}
              >{g.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <>
          <div className="byo-stat-row">
            {[0,1,2,3].map((i) => (
              <div key={i} className="byo-stat">
                <div className="byo-skeleton" style={{ width: 70, height: 10, marginBottom: 12 }} />
                <div className="byo-skeleton" style={{ width: 90, height: 26 }} />
              </div>
            ))}
          </div>
          <div className="byo-skeleton" style={{ height: 220 }} />
        </>
      ) : !data ? null : (
        <>
          {/* Stat tiles */}
          <div className="byo-stat-row">
            <div className="byo-stat">
              <div className="byo-stat-label">Calls</div>
              <div className="byo-stat-value">{fmtCount(data.totals.calls)}</div>
              <div className="byo-stat-sub">in {PERIOD_LABEL[period]?.toLowerCase() || period}</div>
            </div>
            <div className="byo-stat">
              <div className="byo-stat-label">Input tokens</div>
              <div className="byo-stat-value">{fmtTokens(data.totals.input_tokens)}</div>
              <div className="byo-stat-sub">{fmtCount(data.totals.input_tokens)} exact</div>
            </div>
            <div className="byo-stat">
              <div className="byo-stat-label">Output tokens</div>
              <div className="byo-stat-value">{fmtTokens(data.totals.output_tokens)}</div>
              <div className="byo-stat-sub">{fmtCount(data.totals.output_tokens)} exact</div>
            </div>
            <div className="byo-stat">
              <div className="byo-stat-label">Total tokens</div>
              <div className="byo-stat-value">{fmtTokens(data.totals.total_tokens)}</div>
              <div className="byo-stat-sub">{fmtCount(data.totals.total_tokens)} exact</div>
            </div>
          </div>

          {/* Budget card */}
          {data.budget && (
            <BudgetCard
              orgId={orgId}
              accessToken={accessToken}
              budget={data.budget}
              budgetTier={budgetTier}
              budgetPct={budgetPct}
              onSaved={load}
            />
          )}

          {/* Time-series area chart OR top-N bars */}
          {showAreaChart ? (
            <div className="byo-chart-card">
              <div className="byo-chart-head">
                <div className="byo-chart-title">Tokens over time</div>
                <div className="byo-chart-meta">{data.buckets.length} day{data.buckets.length === 1 ? '' : 's'} of data</div>
              </div>
              <AreaChart data={data.buckets} formatVal={fmtTokens} />
            </div>
          ) : (
            <div className="byo-chart-card">
              <div className="byo-chart-head">
                <div className="byo-chart-title">
                  {groupBy === 'vendor' ? 'Spend by vendor'
                   : groupBy === 'model' ? 'Spend by model'
                   : 'Spend by feature'}
                </div>
                <div className="byo-chart-meta">{data.buckets.length} buckets</div>
              </div>
              {data.buckets.length === 0 ? (
                <div className="byo-empty">No usage in this window.</div>
              ) : (
                <div className="byo-toplist">
                  {data.buckets.slice(0, 12).map((b) => (
                    <div key={b.key} className="byo-toplist-row">
                      <span className="byo-toplist-key">{b.key}</span>
                      <div className="byo-toplist-bar">
                        <div className="byo-toplist-bar-fill" style={{ width: `${pctOfMax(b.total, topListMax)}%` }} />
                      </div>
                      <span className="byo-toplist-tokens">{fmtTokens(b.total)}</span>
                      <span className="byo-toplist-calls">{fmtCount(b.calls)} calls</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── Sub-components ─────────────────────────────────────── */

function BudgetCard({ orgId, accessToken, budget, budgetTier, budgetPct, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);

  const startEdit = () => {
    // Convert to "millions of tokens" for human-friendly editing —
    // a 10M budget reads better than 10000000.
    setDraft(budget.monthly_token_budget ? String(budget.monthly_token_budget / 1_000_000) : '');
    setEditing(true);
    setErr(null);
  };

  const save = async (rawValue) => {
    setBusy(true); setErr(null);
    try {
      const isUnlimited = rawValue === null;
      const tokens = isUnlimited ? null : Math.round(Number(rawValue) * 1_000_000);
      if (!isUnlimited && (!Number.isFinite(tokens) || tokens < 0)) {
        setErr('Enter a non-negative number of millions, or use Unlimited.');
        return;
      }
      const resp = await apiFetch(
        `/api/organizations/${orgId}/budget`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthly_token_budget: tokens }),
        },
        accessToken,
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) { setErr(json.error || 'Save failed.'); return; }
      setEditing(false);
      onSaved?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="byo-budget-card">
      <div className="byo-budget-text">
        <div className="byo-budget-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Monthly token budget</span>
          {!editing && (
            <button type="button" className="byo-btn byo-btn--ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={startEdit}>
              {budget.monthly_token_budget ? 'Edit' : 'Set budget'}
            </button>
          )}
        </div>

        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <input
              type="number"
              min="0"
              step="0.5"
              className="byo-form-input"
              style={{ width: 140 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. 50"
              autoFocus
              disabled={busy}
            />
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>million tokens / month</span>
            <button type="button" className="byo-btn byo-btn--primary" disabled={busy || draft === ''} onClick={() => save(draft)}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="byo-btn" disabled={busy} onClick={() => save(null)}>
              Unlimited
            </button>
            <button type="button" className="byo-btn byo-btn--ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : budget.monthly_token_budget ? (
          <>
            <div className="byo-budget-numbers">
              <strong>{fmtTokens(budget.tokens_consumed_this_month)}</strong>
              {' '}of {fmtTokens(budget.monthly_token_budget)} consumed
            </div>
            <div className="byo-budget-bar">
              <div className="byo-budget-bar-fill" data-tier={budgetTier} style={{ width: `${budgetPct}%` }} />
              <div className="byo-budget-bar-marker" />
            </div>
            <div className={`byo-budget-foot ${budget.alerted_at_80pct ? 'byo-budget-foot--alert' : ''}`}>
              {budget.alerted_at_80pct
                ? `⚠ 80% threshold reached on ${new Date(budget.alerted_at_80pct).toLocaleDateString()}.`
                : 'Marker shows 80% soft-warn threshold. Hard cap fires at 100%.'}
            </div>
          </>
        ) : (
          <div className="byo-budget-numbers">
            No budget set — tracked for observability only. {fmtTokens(budget.tokens_consumed_this_month)} consumed this month.
          </div>
        )}

        {err && <div className="byo-banner byo-banner--error" style={{ marginTop: 8 }}>⚠ {err}</div>}
      </div>
      {!editing && budget.monthly_token_budget && <BudgetGauge pct={budgetPct} tier={budgetTier} />}
    </div>
  );
}

function BudgetGauge({ pct, tier }) {
  // Circular gauge: stroke-dashoffset on a 76-circumference circle.
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="byo-budget-gauge" aria-label={`${pct}% of budget consumed`}>
      <svg viewBox="0 0 96 96" width="96" height="96">
        <circle className="byo-budget-gauge-track" cx="48" cy="48" r={radius} />
        <circle
          className="byo-budget-gauge-fill"
          data-tier={tier}
          cx="48" cy="48" r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="byo-budget-gauge-text">{pct}%</div>
    </div>
  );
}
