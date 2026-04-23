'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import HeroVideo from '@/components/marketing/HeroVideo';
import './marketing.css';

/** Embed URL for the marketing-page demo (YouTube / Vimeo / Loom “embed” link). Replace with your walkthrough. */
const DEMO_VIDEO_EMBED_URL =
  'https://pmtmxtzuuljoslehwzcz.supabase.co/storage/v1/object/sign/Videos/hero-bg.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8wOGU1M2QyMS1iMGQ4LTQ4ZjUtYjE4NC1kZjRjYWU4ZDQ4OWQiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJWaWRlb3MvaGVyby1iZy5tcDQiLCJpYXQiOjE3NzQzOTUxMTIsImV4cCI6MTgwNTkzMTExMn0.aMwJeWkY3pjyvyjeMet50bOmDVaFdN9hZpeeYJWbTe0';

const ArrowIcon = () => (
  <svg className="arrow-icon" viewBox="0 0 16 16" fill="none">
    <path d="M3.5 8h9m0 0L9 4.5M12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── Signals ── */
const signals = [
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" /></svg>,
    headline: 'Processes that take days when they should take hours',
    detail: 'Approvals stall, handoffs multiply, and no-one can explain why a simple request takes two weeks. The cost compounds silently: overtime, missed deadlines, and frustrated clients.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" /></svg>,
    headline: 'Spreadsheets holding critical operations together',
    detail: 'Key workflows live in files that one person understands. When they\'re away, everything stops. You\'ve outgrown the tool, but nobody has time to replace it.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>,
    headline: 'New tools bought but never fully adopted',
    detail: 'The software was meant to fix everything. Instead, the team built workarounds on top of workarounds. You\'re paying for licences nobody uses properly.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>,
    headline: 'Growing headcount but not growing output',
    detail: 'You keep hiring, but throughput barely shifts. The bottleneck isn\'t people, it\'s the process underneath them.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    headline: 'No clear picture of what things actually cost to run',
    detail: 'You know the outcome, but not the operational cost of producing it. Without a baseline, every improvement decision is guesswork.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    headline: 'Decisions made by email chain instead of data',
    detail: 'Information is scattered across inboxes and chat threads. By the time it\'s gathered, the moment, and the margin, has passed.',
  },
];

/* ── Where we work - segment cards (context + typical problems) ── */
const segments = [
  {
    color: 'teal', num: '01',
    label: 'Scaling Mid-Market',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>,
    tagline: 'Growing companies, breaking processes',
    outcome: 'We surface exactly where your operations are slowing you down, and what fixing them is worth.',
  },
  {
    color: 'indigo', num: '02',
    label: 'M&A Integration',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="18" r="3" /><circle cx="16" cy="6" r="3" /><path d="M8 15V9a6 6 0 016-6" /><path d="M16 9v6a6 6 0 01-6 6" /></svg>,
    tagline: 'Structure from Day 1, not Day 100',
    outcome: 'Operational clarity to post-merger complexity before it compounds into something harder to fix.',
  },
  {
    color: 'purple', num: '03',
    label: 'Private Equity',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg>,
    tagline: 'From acquisition baseline to exit-ready',
    outcome: 'Operational excellence that shows up in the multiple, from Day 1 post-acquisition to the data room.',
  },
  {
    color: 'gold', num: '04',
    label: 'High-stakes Events',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
    tagline: 'Carve-outs, ERP, VC-backed scale-ups',
    outcome: 'Hard deadlines, no room to improvise. We provide the structure when the stakes are highest.',
  },
];

function ServicesSegments() {
  return (
    <div className="seg-grid">
      {segments.map((s) => (
        <div key={s.label} className={`seg-card seg-card--${s.color} scroll-reveal`}>
          <div className={`seg-card-icon seg-card-icon--${s.color}`}>{s.icon}</div>
          <div className={`seg-card-label seg-card-label--${s.color}`}>{s.label}</div>
          <p className="seg-card-tagline">{s.tagline}</p>
          <p className="seg-card-outcome">{s.outcome}</p>
          <a href="#diagnostic" onClick={(e) => { e.preventDefault(); document.getElementById('diagnostic')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={`seg-card-cta seg-card-cta--${s.color}`}>
            Get in touch <ArrowIcon />
          </a>
        </div>
      ))}
    </div>
  );
}

/* ── Process flow ── */
const flowOutputs = [
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>, label: 'Every process mapped', sub: 'Living maps you can revisit as the business changes' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, label: 'Bottlenecks quantified', sub: 'Cost to nearest £1,000 p/a. Track where waste returns.' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>, label: 'Prioritised roadmap', sub: 'Highest ROI first. Re-run when priorities shift.' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>, label: 'Freed capacity redirected', sub: 'Into revenue-generating work' },
];

const flowBenefits = [
  { title: 'Evidence-based', desc: 'Findings anchored to real process data, not interviews' },
  { title: 'Financially quantified', desc: 'Quantify the cost of your bottlenecks' },
  { title: 'Continuous monitoring', desc: 'Re-map and compare over time, and catch drift before it compounds' },
  { title: 'Fix-first', desc: 'Repair processes before any automation is applied' },
];

const visibilityStripCards = [
  {
    title: 'Stays current as the business changes',
    body: 'Process maps, costs, and bottlenecks live where your team already works. Update when things shift, not when someone digs up an old deck.',
    icon: 'workspace',
  },
  {
    title: 'Baseline, drift, and scenarios',
    body: 'Compare new runs to your baseline to spot drift in cycle time and cost. Run scenarios on volumes, headcount, and assumptions so you see the range of outcomes before they hit the P&L.',
    icon: 'scenarios',
  },
  {
    title: 'One source of truth',
    body: 'Single picture of how work actually flows. No more one-off PDFs that age out and are impossible to find when you need them.',
    icon: 'truth',
  },
];

function VisibilityCardIcon({ name }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'workspace') {
    return (
      <svg {...p} aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === 'scenarios') {
    return (
      <svg {...p} aria-hidden>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    );
  }
  return (
    <svg {...p} aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function VisibilityStripVisual() {
  return (
    <div className="csv-visual-wrap" aria-hidden="true">
      <div className="csv-glow" />
      <div className="csv-panel">
        <div className="csv-panel-bar">
          <span className="csv-panel-dots">
            <span /><span /><span />
          </span>
          <span className="csv-panel-title">vesno.app / processes</span>
          <span className="csv-panel-live">Live</span>
        </div>
        <div className="csv-panel-body">
          <div className="csv-spark-block">
            <span className="csv-spark-caption">Cost vs baseline · rolling</span>
            <svg className="csv-spark-svg" viewBox="0 0 320 78" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="csvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1="62" x2="320" y2="62" stroke="rgba(15,23,42,0.08)" strokeWidth="1" />
              <path
                d="M0 50 L48 45 L96 42 L144 45 L192 38 L240 33 L288 24 L320 19 L320 62 L0 62 Z"
                fill="url(#csvGrad)"
              />
              <path
                d="M0 50 L48 45 L96 42 L144 45 L192 38 L240 33 L288 24 L320 19"
                fill="none"
                stroke="#0d9488"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="288" cy="24" r="4.5" fill="#fff" stroke="#0d9488" strokeWidth="2" />
            </svg>
          </div>
          <div className="csv-pills">
            <span className="csv-pill csv-pill--warn">Drift vs baseline</span>
            <span className="csv-pill csv-pill--teal">Single source of truth</span>
          </div>
          <div className="csv-step-loop">
            <div className="csv-step">
              <span className="csv-step-num">1</span>
              <span className="csv-step-lbl">Map</span>
            </div>
            <svg className="csv-step-arrow" viewBox="0 0 24 12" width="28" height="14" aria-hidden>
              <path d="M0 6h18m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
            <div className="csv-step">
              <span className="csv-step-num">2</span>
              <span className="csv-step-lbl">Monitor</span>
            </div>
            <svg className="csv-step-arrow" viewBox="0 0 24 12" width="28" height="14" aria-hidden>
              <path d="M0 6h18m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
            <div className="csv-step">
              <span className="csv-step-num">3</span>
              <span className="csv-step-lbl">Re-map</span>
            </div>
          </div>
          <div className="csv-foot">
            <span className="csv-foot-muted">Not a one-off PDF, but a workspace that updates with your ops</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketingClient() {
  const navRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { user: sessionUser, signOut: sessionSignOut } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      if (!navRef.current) return;
      navRef.current.classList.toggle('scrolled', window.scrollY > 80);
    };
    handleScroll(); // run on mount in case page loads scrolled
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.06, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.scroll-reveal').forEach((el, i) => {
      el.style.transitionDelay = `${(i % 4) * 0.1}s`;
      observer.observe(el);
    });

    // Continuous stagger loop for comparison panels
    const stopFns = [];

    const animObserver = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        animObserver.unobserve(e.target);
        if (e.target.classList.contains('legacy') || e.target.classList.contains('ai') || e.target.classList.contains('new')) {
          e.target.classList.add('anim-triggered');
        }
        if (e.target.classList.contains('new')) {
          const slides = Array.from(e.target.querySelectorAll('.portal-slide'));
          const dotEls = Array.from(e.target.querySelectorAll('.ps-dot-ind'));
          if (!slides.length) return;

          function triggerMapAnim(slide) {
            const nodes = Array.from(slide.querySelectorAll('[data-map-node]'));
            const edges = Array.from(slide.querySelectorAll('[data-map-edge]'));
            if (!nodes.length) return;
            nodes.forEach(n => n.classList.remove('pm-step--vis'));
            edges.forEach(ed => ed.classList.remove('pm-arrow--vis'));
            nodes.forEach((n, i) => {
              setTimeout(() => n.classList.add('pm-step--vis'), 800 + i * 900);
              if (edges[i]) setTimeout(() => edges[i].classList.add('pm-arrow--vis'), 800 + i * 900 + 440);
            });
          }

          let idx = 0;
          slides[0].classList.add('active');
          triggerMapAnim(slides[0]);
          const id = setInterval(() => {
            const prev = slides[idx];
            idx = (idx + 1) % slides.length;
            const next = slides[idx];
            prev.classList.add('exiting');
            next.classList.add('active');
            dotEls.forEach((d, i) => d.classList.toggle('ps-dot-ind--active', i === idx));
            triggerMapAnim(next);
            setTimeout(() => prev.classList.remove('active', 'exiting'), 700);
          }, 16000);
          stopFns.push(() => { clearInterval(id); slides.forEach(s => s.classList.remove('active', 'exiting')); });
        }
      }),
      { threshold: 0.18 }
    );
    document.querySelectorAll('.comp-panel').forEach((el) => animObserver.observe(el));

    return () => { observer.disconnect(); animObserver.disconnect(); stopFns.forEach(fn => fn()); };
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const scrollTo = (id) => (e) => {
    e.preventDefault(); closeMenu();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mkt">

      {/* Nav */}
      <nav ref={navRef} className="mkt-nav">
        <div className="nav-inner">
          <Link href="/" className="logo" onClick={closeMenu}>
            Vesno<span className="logo-accent">.</span>
          </Link>
          <button
            className={`nav-toggle${menuOpen ? ' open' : ''}`}
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span /><span /><span />
          </button>
          <ul className={menuOpen ? 'open' : ''}>
            <li><a href="#services" onClick={scrollTo('services')}>Our Value Add</a></li>
            <li><a href="#approach" onClick={scrollTo('approach')}>Approach</a></li>
            <li><Link href="/portal" onClick={closeMenu}>Client Login</Link></li>
            <li><a href="#diagnostic" className="cta-nav" onClick={scrollTo('diagnostic')}>Get Started</a></li>
            {sessionUser?.email && (
              <li><button type="button" className="nav-signout-btn" onClick={() => { closeMenu(); sessionSignOut(); }}>Sign Out</button></li>
            )}
          </ul>
        </div>
      </nav>

      {/* Hero, full-width headline, stat bar below */}
      <section className="hero">
        <HeroVideo />
        <div className="hero-overlay" />
        <div className="hero-main">
          <div className="hero-inner">
            <div className="hero-content">
              <h1>
                <span className="hero-line">Operational friction costs</span>{' '}
                <span className="hero-line">more than you think.</span>
              </h1>
              <p className="hero-desc">
                We find the hidden capacity in your operations, so your team delivers more.
            
              </p>
              <div className="hero-cta-row">
                <Link href="/process-audit" className="btn-primary" target="_blank" rel="noopener noreferrer">
                  Start Free Process Audit <ArrowIcon />
                </Link>
                <a href="#comparison" className="btn-secondary" onClick={scrollTo('comparison')}>
                  See how we&apos;re different
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Stat bar, OffDeal style, full-width inside hero, at the bottom */}
        <div className="hero-stat-bar">
          <div className="hero-inner hero-stat-bar-inner">
            <div className="hero-stat-item">
              <span className="hero-stat-num">Process-first</span>
              <span className="hero-stat-label">Anchored to real steps, dates, and volumes, not interviews</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat-item">
              <span className="hero-stat-num">Human + AI</span>
              <span className="hero-stat-label">Expert-led analysis, accelerated by audit tooling</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat-item">
              <span className="hero-stat-num">Continuous visibility</span>
              <span className="hero-stat-label">Monitor processes over time, and see when reality diverges from the map</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat-item">
              <span className="hero-stat-num">Free audit</span>
              <span className="hero-stat-label">Start with a full process audit at no cost</span>
            </div>
          </div>
        </div>
      </section>

      {/* Where we work - segment contexts */}
      <section className="services-section section--light" id="services">
        <div className="container">
          <div className="section-header section-header--center scroll-reveal">
            <div className="section-rule" />
            <div className="section-label">Our Value Add</div>
            <h2 className="section-title">Wherever the complexity lives,<br /><em>we work there</em></h2>
            <p className="section-desc">
              Four contexts we see most often, each with its own operating rhythm and failure modes. Same audit discipline; different pressure points.
            </p>
          </div>
          <ServicesSegments />
        </div>
      </section>

      {/* Comparison */}
      <section className="comparison-section section--light" id="comparison">
        <div className="container">
          <div className="section-header section-header--center scroll-reveal">
            <div className="section-rule" />
            <div className="section-label">What Makes Us Different</div>
            <h2 className="section-title">Fix the process.<br /><em>Then automate.</em></h2>
          </div>

          <div className="comp-grid">
            {/* Legacy consulting, Sound familiar */}
            <div className="comp-panel legacy">
              <div className="comp-panel-label">The Legacy Trap</div>
              <h3>Sounds familiar?</h3>
              <div className="mockup">
                <div className="mockup-bar">
                  <div className="mockup-dot r" /><div className="mockup-dot y" /><div className="mockup-dot g" />
                  <div className="mockup-bar-title">Sound familiar?</div>
                </div>
                <div className="mockup-body">
                  <div className="chaos-stack">
                    {signals.map((s, i) => (
                      <div key={i} className="chaos-card chaos-card--anim" data-delay={i % 6}>
                        <div className="cc-icon">{s.icon}</div>
                        <div style={{ flex: 1 }}>
                          <div className="cc-title">{s.headline}</div>
                        </div>
                        <div className={`chaos-badge ${['warn', 'stale', 'err', 'warn', 'stale', 'err'][i]}`}>
                          {['Common', 'Typical', 'Frequent', 'Common', 'Typical', 'Frequent'][i]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* AI-first */}
            <div className="comp-panel ai">
              <div className="comp-panel-label">The Hype Trap</div>
              <h3>&ldquo;How can fix these with AI?&rdquo;</h3>
              <div className="mockup">
                <div className="mockup-bar">
                  <div className="mockup-dot r" /><div className="mockup-dot y" /><div className="mockup-dot g" />
                  <div className="mockup-bar-title">ai-strategy.slack</div>
                </div>
                <div className="mockup-body">
                  <div className="ai-chat-mock">
                    <div className="ai-chat-bubble user">
                      <div className="bubble-tag">Executive</div>
                      &ldquo;We need to deploy AI. Our competitors are doing it.&rdquo;
                    </div>
                    <div className="ai-chat-bubble bot">
                      <div className="bubble-tag">AI Vendor</div>
                      &ldquo;Our platform can automate your processes and generate cost savings. Connect your data and...&rdquo;
                    </div>
                    <div className="ai-chat-bubble user">
                      <div className="bubble-tag">Executive</div>
                      &ldquo;Which processes do we start with?&rdquo;
                    </div>
                    <div className="ai-chat-bubble bot">
                      <div className="bubble-tag">AI Vendor</div>
                      &ldquo;Just select one for a pilot and we'll take it from there. &rdquo;
                    </div>
                    <div className="ai-warn-row">
                      <span className="warn-icon">⚠️</span>
                      No process understanding. No baseline metrics. No understanding of what&apos;s actually broken.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Vesno */}
            <div className="comp-panel new">
              <div className="comp-panel-label">The Vesno Way</div>
              <h3>Process-first strategy</h3>
              <p className="comp-panel-desc">
                Maps, reports, and cost models stay in your portal. Revisit and refresh as you ship changes, not a one-off engagement.
              </p>

              <div className="portal-carousel">

                {/* Slide 1, Flow Canvas (animated process mapping, snake layout) */}
                <div className="portal-slide">
                  <div className="ps-bar">
                    <span className="ps-dot r"/><span className="ps-dot y"/><span className="ps-dot g"/>
                    <span className="ps-bar-title">Flow Canvas · Invoice Approval</span>
                    <span className="ps-bar-chip">Finance · Management</span>
                  </div>
                  <div className="ps-body ps-body--map">
                    <div className="pm-canvas">

                      {/* Start terminal, own row above Row 1 */}
                      <div className="pm-term-row pm-term-row--s">
                        <div className="pm-terminal" data-map-node="s"><span>Start</span></div>
                      </div>
                      <div className="pm-term-wire pm-term-wire--s" data-map-edge="0"/>

                      {/* Row 1, L→R */}
                      <div className="pm-row">
                        <div className="pm-step" data-map-node="0">
                          <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                          <span className="pm-step-num">01</span>
                          <span className="pm-step-name">Invoice<br/>Received</span>
                          <span className="pm-step-dept">Finance</span>
                        </div>
                        <div className="pm-arrow" data-map-edge="1"/>
                        <div className="pm-step" data-map-node="1">
                          <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                          <span className="pm-step-num">02</span>
                          <span className="pm-step-name">Validate<br/>PO</span>
                          <span className="pm-step-dept">Finance</span>
                        </div>
                        <div className="pm-arrow" data-map-edge="2"/>
                        <div className="pm-step" data-map-node="2">
                          <span className="pm-step-bar" style={{background:'#6366f1'}}/>
                          <span className="pm-step-num">03</span>
                          <span className="pm-step-name">Assign<br/>GL Code</span>
                          <span className="pm-step-dept">AP</span>
                        </div>
                        <div className="pm-arrow" data-map-edge="3"/>
                        <div className="pm-step" data-map-node="3">
                          <span className="pm-step-bar" style={{background:'#6366f1'}}/>
                          <span className="pm-step-num">04</span>
                          <span className="pm-step-name">Duplicate<br/>Check</span>
                          <span className="pm-step-dept">AP</span>
                        </div>
                      </div>

                      {/* Turn: right side going down */}
                      <div className="pm-turn-wrap pm-turn-wrap--r" data-map-edge="4"/>

                      {/* Row 2, R→L (row-reverse; N04 is rightmost connecting from turn) */}
                      <div className="pm-row pm-row--rtl">
                        <div className="pm-step" data-map-node="4">
                          <span className="pm-step-bar" style={{background:'#64748b'}}/>
                          <span className="pm-step-num">05</span>
                          <span className="pm-step-name">Dept.<br/>Review</span>
                          <span className="pm-step-dept">Finance</span>
                        </div>
                        <div className="pm-arrow pm-arrow--rtl" data-map-edge="5"/>
                        <div className="pm-dec-host" data-map-node="5">
                          <div className="pm-dec-diamond">
                            <div className="pm-dec-inner">
                              <span className="pm-dec-num">06</span>
                              <span className="pm-dec-label">Over<br/>£5k?</span>
                            </div>
                          </div>
                          <div className="pm-branch-no" aria-hidden="true">
                            <span className="pm-branch-label">No</span>
                            <div className="pm-branch-line"/>
                          </div>
                        </div>
                        <div className="pm-arrow pm-arrow--rtl pm-arrow--yes" data-map-edge="6"/>
                        <div className="pm-step pm-step--bot" data-map-node="6">
                          <span className="pm-step-bar" style={{background:'#dc2626'}}/>
                          <span className="pm-step-num">07</span>
                          <span className="pm-step-name">Manager<br/>Approval</span>
                          <span className="pm-step-dept">Management</span>
                          <span className="pm-step-warn">⚠</span>
                        </div>
                        <div className="pm-arrow pm-arrow--rtl" data-map-edge="7"/>
                        <div className="pm-step pm-step--bot" data-map-node="7">
                          <span className="pm-step-bar" style={{background:'#dc2626'}}/>
                          <span className="pm-step-num">08</span>
                          <span className="pm-step-name">Director<br/>Sign-off</span>
                          <span className="pm-step-dept">Management</span>
                          <span className="pm-step-warn">⚠</span>
                        </div>
                      </div>

                      {/* Turn: left side going down */}
                      <div className="pm-turn-wrap pm-turn-wrap--l" data-map-edge="8"/>

                      {/* Row 3, L→R */}
                      <div className="pm-row">
                        <div className="pm-step" data-map-node="8">
                          <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                          <span className="pm-step-num">09</span>
                          <span className="pm-step-name">Notify<br/>AP Team</span>
                          <span className="pm-step-dept">AP</span>
                        </div>
                        <div className="pm-arrow" data-map-edge="9"/>
                        <div className="pm-step" data-map-node="9">
                          <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                          <span className="pm-step-num">10</span>
                          <span className="pm-step-name">Schedule<br/>Payment</span>
                          <span className="pm-step-dept">Finance</span>
                        </div>
                        <div className="pm-arrow" style={{visibility:'hidden'}} data-map-edge="10"/>
                        <div className="pm-step" data-map-node="10">
                          <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                          <span className="pm-step-num">11</span>
                          <span className="pm-step-name">Bank<br/>Transfer</span>
                          <span className="pm-step-dept">Finance</span>
                        </div>
                        <div className="pm-arrow" data-map-edge="11"/>
                        <div className="pm-step" data-map-node="11">
                          <span className="pm-step-bar" style={{background:'#6366f1'}}/>
                          <span className="pm-step-num">12</span>
                          <span className="pm-step-name">Archive<br/>Invoice</span>
                          <span className="pm-step-dept">AP</span>
                        </div>
                      </div>

                      {/* End terminal, own row below Row 3 */}
                      <div className="pm-term-wire pm-term-wire--e" data-map-edge="12"/>
                      <div className="pm-term-row pm-term-row--e">
                        <div className="pm-terminal pm-terminal--end" data-map-node="e"><span>Done</span></div>
                      </div>

                    </div>
                    <div className="pm-footer-strip">
                      <span className="pm-fs-badge pm-fs-badge--bot">⚠ 2 bottlenecks</span>
                      <span className="pm-fs-badge pm-fs-badge--auto">4 automatable</span>
                      <span className="pm-fs-badge pm-fs-badge--time">~6h avg</span>
                    </div>
                  </div>
                </div>

                {/* Slide 2, Diagnostic report */}
                <div className="portal-slide portal-slide--fast">
                  <div className="ps-bar">
                    <span className="ps-dot r"/><span className="ps-dot y"/><span className="ps-dot g"/>
                    <span className="ps-bar-title">Process Audit Report · XYZ Group</span>
                    <span className="ps-bar-grade">B+</span>
                  </div>
                  <div className="ps-body">
                    <div className="ps-d-top">
                      <div className="ps-ring-wrap">
                        <svg viewBox="0 0 52 52" width="52" height="52" style={{flexShrink:0}}>
                          <circle cx="26" cy="26" r="20" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="3.5"/>
                          <circle cx="26" cy="26" r="20" fill="none" stroke="#0d9488" strokeWidth="3.5"
                            strokeDasharray="125.7" strokeDashoffset="83.8" strokeLinecap="round"
                            transform="rotate(-90 26 26)"/>
                        </svg>
                        <div className="ps-ring-label">34%<span>auto</span></div>
                      </div>
                      <div className="ps-kpis">
                        <div className="ps-kpi"><span className="ps-kpi-v">8</span><span className="ps-kpi-l">Processes</span></div>
                        <div className="ps-kpi"><span className="ps-kpi-v">47</span><span className="ps-kpi-l">Steps mapped</span></div>
                        <div className="ps-kpi ps-kpi--warn"><span className="ps-kpi-v">5</span><span className="ps-kpi-l">Bottlenecks</span></div>
                      </div>
                    </div>
                    <div className="ps-proc-list">
                      <div className="ps-proc">
                        <span className="ps-proc-dot" style={{background:'#0d9488'}}/>
                        <span className="ps-proc-name">Invoice Approval</span>
                        <div className="ps-proc-bar"><div style={{width:'72%',background:'#0d9488'}} className="ps-proc-fill"/></div>
                        <span className="ps-proc-pct">72%</span>
                      </div>
                      <div className="ps-proc">
                        <span className="ps-proc-dot" style={{background:'#d97706'}}/>
                        <span className="ps-proc-name">Client Onboarding</span>
                        <div className="ps-proc-bar"><div style={{width:'38%',background:'#d97706'}} className="ps-proc-fill"/></div>
                        <span className="ps-proc-pct">38%</span>
                      </div>
                      <div className="ps-proc">
                        <span className="ps-proc-dot" style={{background:'#dc2626'}}/>
                        <span className="ps-proc-name">Staff Induction</span>
                        <div className="ps-proc-bar"><div style={{width:'18%',background:'#dc2626'}} className="ps-proc-fill"/></div>
                        <span className="ps-proc-pct">18%</span>
                      </div>
                    </div>
                    <div className="ps-d-footer">
                      <span className="ps-d-total">£142,400/yr total cost</span>
                      <span className="ps-d-opp">Est. £89k automatable</span>
                    </div>
                  </div>
                </div>

                {/* Slide 3, Cost analysis */}
                <div className="portal-slide portal-slide--fast">
                  <div className="ps-bar">
                    <span className="ps-dot r"/><span className="ps-dot y"/><span className="ps-dot g"/>
                    <span className="ps-bar-title">Cost Analysis · Meridian Group</span>
                  </div>
                  <div className="ps-body">
                    <div className="ps-cost-head">
                      <div className="ps-cost-true">
                        <span className="ps-cost-val">£142,400</span>
                        <span className="ps-cost-lbl">true annual cost</span>
                      </div>
                      <div className="ps-cost-chips">
                        <span className="ps-chip ps-chip--warn">+£18k rework</span>
                        <span className="ps-chip ps-chip--muted">+£16k idle time</span>
                      </div>
                    </div>
                    <div className="ps-sc-tabs">
                      <span className="ps-sc-tab">Conservative</span>
                      <span className="ps-sc-tab ps-sc-tab--active">Base Case</span>
                      <span className="ps-sc-tab">Optimistic</span>
                    </div>
                    <div className="ps-sc-body">
                      <div className="ps-sc-saving">
                        <span className="ps-sc-amt">£62,000</span>
                        <span className="ps-sc-sub">saved per year · 44% reduction</span>
                      </div>
                      <div className="ps-sc-bar-wrap">
                        <div className="ps-sc-bar-track">
                          <div className="ps-sc-bar-fill" style={{width:'44%'}}/>
                        </div>
                        <span className="ps-sc-bar-label">of £142k base cost</span>
                      </div>
                    </div>
                    <div className="ps-roi-row">
                      <div className="ps-roi-m"><span className="ps-roi-v">14mo</span><span className="ps-roi-l">Payback</span></div>
                      <div className="ps-roi-m"><span className="ps-roi-v">180%</span><span className="ps-roi-l">3yr ROI</span></div>
                      <div className="ps-roi-m"><span className="ps-roi-v">2.4</span><span className="ps-roi-l">FTE freed</span></div>
                    </div>
                  </div>
                </div>

                {/* Slide 4, Process health / drift monitoring */}
                <div className="portal-slide portal-slide--fast">
                  <div className="ps-bar">
                    <span className="ps-dot r"/><span className="ps-dot y"/><span className="ps-dot g"/>
                    <span className="ps-bar-title">Process health · Invoice Approval</span>
                    <span className="ps-bar-chip ps-bar-chip--pulse">Drift watch</span>
                  </div>
                  <div className="ps-body ps-body--monitor">
                    <div className="ps-monitor-head">
                      <span className="ps-monitor-base">Baseline · Jan 2026</span>
                      <span className="ps-monitor-pill">Drift vs baseline</span>
                    </div>
                    <div className="ps-monitor-rows">
                      <div className="ps-monitor-row">
                        <span className="ps-monitor-metric">Cycle time</span>
                        <span className="ps-monitor-val">4.2 d</span>
                        <span className="ps-monitor-delta ps-monitor-delta--bad">+12%</span>
                      </div>
                      <div className="ps-monitor-row">
                        <span className="ps-monitor-metric">Dwell at approval</span>
                        <span className="ps-monitor-val">1.8 d</span>
                        <span className="ps-monitor-delta ps-monitor-delta--ok">−4%</span>
                      </div>
                      <div className="ps-monitor-row">
                        <span className="ps-monitor-metric">True annual cost</span>
                        <span className="ps-monitor-val">£148k</span>
                        <span className="ps-monitor-delta ps-monitor-delta--bad">+£5.6k</span>
                      </div>
                    </div>
                    <div className="ps-monitor-spark" aria-hidden="true">
                      <span className="ps-monitor-spark-label">12-week trend</span>
                      <svg className="ps-monitor-spark-svg" viewBox="0 0 120 32" preserveAspectRatio="none">
                        <path d="M0 24 L20 22 L40 18 L60 20 L80 12 L100 8 L120 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="ps-monitor-foot">
                      <span className="ps-monitor-sync">Compared 2 days ago · next auto-compare in 5d</span>
                      <span className="ps-monitor-cta">Re-baseline</span>
                    </div>
                  </div>
                </div>

                {/* Dots indicator */}
                <div className="ps-dots">
                  <span className="ps-dot-ind ps-dot-ind--active"/>
                  <span className="ps-dot-ind"/>
                  <span className="ps-dot-ind"/>
                  <span className="ps-dot-ind"/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Approach, flow diagram */}
      <section className="approach-section" id="approach">
        <div className="container">
          <div className="section-header section-header--center scroll-reveal">
            <div className="section-rule" />
            <div className="section-label">Our Approach</div>
            <h2 className="section-title">The modern approach to<br /><em>operational efficiency</em></h2>
            <p className="section-desc">
              Most audits end in a deck that goes stale the week it lands. Vesno keeps your processes, costs, and bottlenecks in a living workspace, so you have ongoing visibility and can steer as operations change.
            </p>
          </div>

          <div className="flow-diagram scroll-reveal">
            {/* Left, client input card */}
            <div className="flow-input-card">
              <div className="flow-input-avatar">
                <img src="https://randomuser.me/api/portraits/men/30.jpg" alt="You" width="48" height="48" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} />
              </div>
              <div className="flow-input-name">You</div>
              <div className="flow-input-org">Complete the process audit</div>
              <div className="flow-input-fields">
                <div className="flow-input-row">
                  <span className="flow-input-key">Your processes</span>
                  <span className="flow-input-val">Real steps</span>
                </div>
                <div className="flow-input-row">
                  <span className="flow-input-key">Your data</span>
                  <span className="flow-input-val">Real volumes</span>
                </div>
                <div className="flow-input-row">
                  <span className="flow-input-key">Your team</span>
                  <span className="flow-input-val">Real owners</span>
                </div>
              </div>
              <div className="flow-input-tag">Self-serve · Free</div>
            </div>

            {/* Arrow in */}
            <div className="flow-arrow flow-arrow--in">
              <svg viewBox="0 0 60 20" fill="none" width="60" height="20">
                <path d="M0 10 L50 10" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3"/>
                <path d="M44 5 L54 10 L44 15" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>

            {/* Centre, Vesno engine */}
            <div className="flow-engine">
              <div className="flow-engine-logo">Vesno<span>.</span></div>
              <div className="flow-engine-modules">
                <div className="flow-engine-module flow-engine-module--ai">
                  <div className="flow-engine-module-avatar flow-engine-module-avatar--ai" role="img" aria-label="AI">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
                      <path d="M5 3v4M19 17v4M3 5h4M17 19h4" />
                    </svg>
                  </div>
                  <div className="flow-engine-module-text">
                    <div className="flow-engine-module-label">Audit Engine</div>
                    <div className="flow-engine-module-sub">Maps processes, quantifies waste, and gives you a baseline you can track over time</div>
                  </div>
                </div>
                <div className="flow-engine-module flow-engine-module--human">
                  <div className="flow-engine-module-avatar" role="img" aria-label="Human expert">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                    </svg>
                  </div>
                  <div className="flow-engine-module-text">
                    <div className="flow-engine-module-label">Operations Advisor</div>
                    <div className="flow-engine-module-sub">Helps you prioritise, and revisit when the process or market shifts</div>
                  </div>
                </div>
              </div>
              <div className="flow-engine-done">
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/><path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="flow-engine-done-text">Instant report · ongoing visibility in your portal</span>
              </div>
            </div>

            {/* Arrow out */}
            <div className="flow-arrow flow-arrow--out">
              <svg viewBox="0 0 60 20" fill="none" width="60" height="20">
                <path d="M0 10 L50 10" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3"/>
                <path d="M44 5 L54 10 L44 15" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>

            {/* Right, outputs */}
            <div className="flow-outputs">
              {flowOutputs.map((o, i) => (
                <div key={i} className="flow-output-chip">
                  <div className="flow-output-icon">{o.icon}</div>
                  <div>
                    <div className="flow-output-label">{o.label}</div>
                    <div className="flow-output-sub">{o.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom benefit labels */}
          <div className="flow-benefits scroll-reveal">
            {flowBenefits.map((b, i) => (
              <div key={i} className="flow-benefit">
                <div className="flow-benefit-title">{b.title}</div>
                <div className="flow-benefit-desc">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Continuous visibility, not one-and-done */}
      <section className="continuous-strip" id="visibility">
        <div className="container">
          <div className="continuous-strip-grid scroll-reveal">
            <div className="continuous-strip-lead">
              <p className="continuous-strip-kicker"></p>
              <h3 className="continuous-strip-title">Visibility that survives the meeting</h3>
            </div>
            <div className="continuous-strip-cards">
              {visibilityStripCards.map((card) => (
                <article key={card.title} className="continuous-strip-card">
                  <div className="continuous-strip-card-icon">
                    <VisibilityCardIcon name={card.icon} />
                  </div>
                  <div className="continuous-strip-card-text">
                    <h4 className="continuous-strip-card-title">{card.title}</h4>
                    <p className="continuous-strip-card-body">{card.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <VisibilityStripVisual />
          </div>
        </div>
      </section>

      {/* Diagnostic CTA */}
      <section className="diagnostic-cta section--light" id="diagnostic">
        <div className="container">
          <div className="diagnostic-cta-content">
            <div className="diagnostic-cta-text">
              <div className="diagnostic-badge"></div>
              <h2>Find out exactly where your <strong>operations are leaking and how to fix them</strong></h2>
              <p></p>
            </div>
            <div className="diagnostic-cta-buttons">
              <a href="https://calendly.com/hope-vesno/vesno-process-audit-introduction" className="btn-white" target="_blank" rel="noopener noreferrer">Book Discovery Call</a>
              <a href="#services" className="btn-outline" onClick={scrollTo('services')}>See our value add</a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mkt-footer">
        <div className="footer-content">
          <div>
            <div className="footer-brand">Vesno<span style={{ fontStyle: 'italic', color: 'var(--accent-mid)' }}>.</span></div>
            <p className="footer-tagline">Evidence-based process intelligence and ongoing operational visibility, not one-off decks, for scaling companies, M&amp;A integration, and private equity portfolios.</p>
          </div>
          <div>
            <h4>Our Value Add</h4>
            <ul>
              <li><a href="#services" onClick={scrollTo('services')}>Scaling Mid-Market</a></li>
              <li><a href="#services" onClick={scrollTo('services')}>M&amp;A Integration</a></li>
              <li><a href="#services" onClick={scrollTo('services')}>Private Equity</a></li>
              <li><a href="#services" onClick={scrollTo('services')}>High-stakes Events</a></li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><a href="#approach" onClick={scrollTo('approach')}>Approach</a></li>
              <li><a href="#diagnostic" onClick={scrollTo('diagnostic')}>Process Audit</a></li>
              <li><a href="#diagnostic" onClick={scrollTo('diagnostic')}>Contact</a></li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              <li><a href="mailto:hope@vesno.io">hope@vesno.io</a></li>
              <li>London, United Kingdom</li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p suppressHydrationWarning>&copy; {new Date().getFullYear()} Vesno. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}