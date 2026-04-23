'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import DealPagePE from './DealPagePE';
import DealPageMA from './DealPageMA';
import DealPageScaling from './DealPageScaling';
import '../deals.css';

const TYPE_LABEL = { pe_rollup: 'PE Roll-up', ma: 'M&A', scaling: 'Scaling' };
const TYPE_COLOR = { pe_rollup: '#8b5cf6', ma: '#6366f1', scaling: '#0d9488' };

export default function DealPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();

  const [deal, setDeal] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=/deals/${id}`);
    }
  }, [user, authLoading, id, router]);

  const loadDeal = async () => {
    if (!id || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(`/api/deals/${id}`, {}, accessToken);
      const data = await resp.json();
      if (!resp.ok) { setError(data.error || 'Failed to load deal.'); return; }
      setDeal(data.deal);
      setParticipants(data.participants || []);
      setSummary(data.summary || {});
    } catch {
      setError('Network error loading deal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) loadDeal();
  }, [id, accessToken]);

  if (authLoading || (!user && !authLoading)) {
    return (
      <div className="deal-page-loading">
        <div className="deal-page-spinner" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="deal-page-wrap">
        <DealNav deal={null} />
        <div className="deal-page-loading">
          <div className="deal-page-spinner" />
          <p>Loading deal…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="deal-page-wrap">
        <DealNav deal={null} />
        <div className="deal-page-error">
          <p>{error}</p>
          <button type="button" className="deal-btn" onClick={loadDeal}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="deal-page-wrap">
      <DealNav deal={deal} />

      <div className="deal-page-header">
        <div className="deal-page-header-left">
          <span
            className="deal-page-type-badge"
            style={{ background: (TYPE_COLOR[deal.type] || '#64748b') + '22', color: TYPE_COLOR[deal.type] || '#64748b' }}
          >
            {TYPE_LABEL[deal.type] || deal.type}
          </span>
          <h1 className="deal-page-title">{deal.name}</h1>
          {deal.processName && (
            <p className="deal-page-process">Process: <strong>{deal.processName}</strong></p>
          )}
        </div>
        <span className={`deal-page-status deal-page-status--${deal.status}`}>
          {deal.status === 'collecting' ? 'Collecting' : deal.status === 'complete' ? 'Complete' : 'Draft'}
        </span>
      </div>

      {deal.type === 'pe_rollup' && (
        <DealPagePE
          deal={deal}
          participants={participants}
          summary={summary}
          accessToken={accessToken}
          onRefresh={loadDeal}
        />
      )}
      {deal.type === 'ma' && (
        <DealPageMA
          deal={deal}
          participants={participants}
          summary={summary}
          accessToken={accessToken}
          onRefresh={loadDeal}
        />
      )}
      {deal.type === 'scaling' && (
        <DealPageScaling
          deal={deal}
          participants={participants}
          summary={summary}
        />
      )}
    </div>
  );
}

function DealNav({ deal }) {
  return (
    <nav className="deal-page-breadcrumb">
      <Link href="/portal" className="deal-breadcrumb-link">Dashboard</Link>
      <span className="deal-breadcrumb-sep">›</span>
      <Link href="/portal?tab=deals" className="deal-breadcrumb-link">Deals</Link>
      {deal && (
        <>
          <span className="deal-breadcrumb-sep">›</span>
          <span className="deal-breadcrumb-current">{deal.name}</span>
        </>
      )}
    </nav>
  );
}
