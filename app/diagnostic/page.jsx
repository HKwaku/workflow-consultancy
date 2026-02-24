'use client';

import { useEffect, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap');

  .diag-root {
    min-height: 100vh;
    background: #0a0a0f;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Sans', sans-serif;
    position: relative;
    overflow: hidden;
  }

  .diag-root::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 50% at 20% 40%, rgba(99, 102, 241, 0.08) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 80% 70%, rgba(16, 185, 129, 0.06) 0%, transparent 55%);
    pointer-events: none;
  }

  .diag-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
  }

  .diag-card {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    padding: 52px 48px 44px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 20px;
    backdrop-filter: blur(24px);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.04) inset,
      0 32px 64px rgba(0,0,0,0.4),
      0 0 80px rgba(99, 102, 241, 0.05);
    max-width: 380px;
    width: 90vw;
    animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .diag-icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(16, 185, 129, 0.1));
    border: 1px solid rgba(99, 102, 241, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 24px rgba(99, 102, 241, 0.15);
  }

  .diag-icon svg {
    width: 24px;
    height: 24px;
    color: #818cf8;
  }

  .diag-text {
    text-align: center;
  }

  .diag-text h2 {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 500;
    color: rgba(255,255,255,0.92);
    letter-spacing: -0.01em;
  }

  .diag-text p {
    margin: 0;
    font-size: 13.5px;
    color: rgba(255,255,255,0.38);
    font-weight: 300;
    line-height: 1.5;
  }

  .diag-progress-track {
    width: 100%;
    height: 2px;
    background: rgba(255,255,255,0.06);
    border-radius: 99px;
    overflow: hidden;
  }

  .diag-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #6366f1, #10b981);
    border-radius: 99px;
    animation: progressFill 1.6s cubic-bezier(0.25, 0, 0.1, 1) forwards;
  }

  @keyframes progressFill {
    from { width: 0%; }
    to   { width: 100%; }
  }

  .diag-step {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    color: rgba(255,255,255,0.2);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .diag-step-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #6366f1;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50%       { opacity: 1;   transform: scale(1.3); }
  }
`;

function DiagnosticRedirect() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [label, setLabel] = useState('Initializing');

  useEffect(() => {
    const labels = ['Initializing', 'Verifying environment', 'Launching diagnostic'];
    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i < labels.length) setLabel(labels[i]);
    }, 520);

    const timeout = setTimeout(() => {
      const url = '/diagnostic.html' + (query ? '?' + query : '');
      window.location.replace(url);
    }, 1600);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [query]);

  return (
    <>
      <style>{styles}</style>
      <div className="diag-root">
        <div className="diag-grid" />
        <div className="diag-card">
          <div className="diag-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
            </svg>
          </div>

          <div className="diag-text">
            <h2>Running Diagnostics</h2>
            <p>Preparing your environment check.<br />You'll be redirected automatically.</p>
          </div>

          <div className="diag-progress-track">
            <div className="diag-progress-fill" />
          </div>

          <div className="diag-step">
            <span className="diag-step-dot" />
            {label}
          </div>
        </div>
      </div>
    </>
  );
}

export default function DiagnosticPage() {
  const fallbackContent = (
    <>
      <style>{styles}</style>
      <div className="diag-root">
        <div className="diag-grid" />
        <div className="diag-card">
          <div className="diag-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
            </svg>
          </div>
          <div className="diag-text">
            <h2>Running Diagnostics</h2>
            <p>Preparing your environment check.</p>
          </div>
          <div className="diag-progress-track">
            <div className="diag-progress-fill" />
          </div>
          <div className="diag-step">
            <span className="diag-step-dot" />
            Initializing
          </div>
        </div>
      </div>
    </>
  );

  return (
    <Suspense fallback={fallbackContent}>
      <DiagnosticRedirect />
    </Suspense>
  );
}
