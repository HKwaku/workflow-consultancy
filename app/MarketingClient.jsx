'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import HeroVideo from '@/components/marketing/HeroVideo';
import './marketing.css';

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
    detail: 'You keep hiring, but throughput barely shifts. The bottleneck isn\'t people — it\'s the process underneath them.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    headline: 'No clear picture of what things actually cost to run',
    detail: 'You know the outcome, but not the operational cost of producing it. Without a baseline, every improvement decision is guesswork.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    headline: 'Decisions made by email chain instead of data',
    detail: 'Information is scattered across inboxes and chat threads. By the time it\'s gathered, the moment — and the margin — has passed.',
  },
];

/* ── Services segments ── */
const segments = [
  {
    color: 'teal', num: '01',
    label: 'Scaling Mid-Market',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>,
    tagline: 'Growing companies, breaking processes',
    outcome: 'We surface exactly where your operations are slowing you down — and what fixing them is worth.',
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
    outcome: 'Operational excellence that shows up in the multiple — from Day 1 post-acquisition to the data room.',
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
          <div className="seg-card-number">{s.num}</div>
          <div className={`seg-card-icon seg-card-icon--${s.color}`}>{s.icon}</div>
          <div className={`seg-card-label seg-card-label--${s.color}`}>{s.label}</div>
          <p className="seg-card-tagline">{s.tagline}</p>
          <p className="seg-card-outcome">{s.outcome}</p>
          <a href="#contact" className={`seg-card-cta seg-card-cta--${s.color}`}>
            Get in touch <ArrowIcon />
          </a>
        </div>
      ))}
    </div>
  );
}

/* ── Process flow ── */
const flowOutputs = [
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>, label: 'Every process mapped', sub: 'Steps, owners, volumes, hand-offs' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, label: 'Bottlenecks quantified', sub: 'Cost to nearest £1,000 p/a' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>, label: 'Prioritised roadmap', sub: 'Highest ROI fixes first' },
  { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>, label: 'Freed capacity redirected', sub: 'Into revenue-generating work' },
];

const flowBenefits = [
  { title: 'Evidence-based', desc: 'Findings anchored to real process data, not interviews' },
  { title: 'Financially quantified', desc: 'Every bottleneck has a £ number attached' },
  { title: 'Same day', desc: 'Full diagnostic delivered in under a working day' },
  { title: 'Fix-first', desc: 'Repair processes before any automation is applied' },
];

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
              setTimeout(() => n.classList.add('pm-step--vis'), 600 + i * 520);
              if (edges[i]) setTimeout(() => edges[i].classList.add('pm-arrow--vis'), 600 + i * 520 + 280);
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
          }, 3600);
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
            Sharpin<span className="logo-accent">.</span>
          </Link>
          <button
            className={`nav-toggle${menuOpen ? ' open' : ''}`}
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span /><span /><span />
          </button>
          <ul className={menuOpen ? 'open' : ''}>
            <li><a href="#diagnostic" onClick={scrollTo('diagnostic')}>Diagnostic</a></li>
            <li><a href="#services" onClick={scrollTo('services')}>Services</a></li>
            <li><a href="#approach" onClick={scrollTo('approach')}>Approach</a></li>
            <li><Link href="/portal" onClick={closeMenu}>Client Login</Link></li>
            <li><a href="#contact" className="cta-nav" onClick={scrollTo('contact')}>Get Started</a></li>
            {sessionUser?.email && (
              <li><button type="button" className="nav-signout-btn" onClick={() => { closeMenu(); sessionSignOut(); }}>Sign Out</button></li>
            )}
          </ul>
        </div>
      </nav>

      {/* Hero — full-width headline, stat bar below */}
      <section className="hero">
        <HeroVideo />
        <div className="hero-overlay" />
        <div className="hero-main">
          <div className="hero-inner">
            <div className="hero-content">
              <h1>
                <span className="hero-line">Operational friction costs</span>
                <span className="hero-line">more than you think.</span>
              </h1>
              <p className="hero-desc">
              We find the hidden capacity in your operations, fixing broken processes and deploying the right technology so your team delivers more.
              </p>
              <div className="hero-cta-row">
                <Link href="/diagnostic" className="btn-primary" target="_blank" rel="noopener noreferrer">
                  Start Free Diagnostic <ArrowIcon />
                </Link>
                <a href="#comparison" className="btn-secondary" onClick={scrollTo('comparison')}>
                  See how we&apos;re different
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Stat bar — OffDeal style, full-width inside hero, at the bottom */}
        <div className="hero-stat-bar">
          <div className="hero-inner hero-stat-bar-inner">
            <div className="hero-stat-item">
              <span className="hero-stat-num">Process-first</span>
              <span className="hero-stat-label">Anchored to real steps, dates, and volumes — not interviews</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat-item">
              <span className="hero-stat-num">Days</span>
              <span className="hero-stat-label">From diagnostic start to full report in your hands</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat-item">
              <span className="hero-stat-num">Human + AI</span>
              <span className="hero-stat-label">Expert-led analysis, accelerated by diagnostic tooling</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat-item">
              <span className="hero-stat-num">£0 upfront</span>
              <span className="hero-stat-label">Diagnostic is free — no retainer, no commitment</span>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="services-section section--light" id="services">
        <div className="container">
          <div className="section-header section-header--center scroll-reveal">
            <div className="section-rule" />
            <div className="section-label">What We Do</div>
            <h2 className="section-title">Wherever the complexity lives,<br /><em>we work there</em></h2>
            <p className="section-desc"></p>
          </div>
          <ServicesSegments />
        </div>
      </section>

      {/* Comparison */}
      <section className="comparison-section section--light" id="comparison">
        <div className="container">
          <div className="section-header section-header--center scroll-reveal">
            <div className="section-rule" />
            <div className="section-label">The Difference</div>
            <h2 className="section-title">Three approaches.<br /><em>One that actually works.</em></h2>
          </div>

          <div className="comp-grid">
            {/* Legacy consulting — Sound familiar */}
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
              <h3>&ldquo;How can we deploy AI?&rdquo;</h3>
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
                      &ldquo;Our platform automates everything. Connect your data and...&rdquo;
                    </div>
                    <div className="ai-chat-bubble user">
                      <div className="bubble-tag">Executive</div>
                      &ldquo;Which processes do we start with?&rdquo;
                    </div>
                    <div className="ai-chat-bubble bot">
                      <div className="bubble-tag">AI Vendor</div>
                      &ldquo;All of them! ROI in 3 months, guaranteed.&rdquo;
                    </div>
                    <div className="ai-warn-row">
                      <span className="warn-icon">⚠️</span>
                      No process mapping. No baseline metrics. No understanding of what&apos;s actually broken.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sharpin */}
            <div className="comp-panel new">
              <div className="comp-panel-label">The Sharpin Way</div>
              <h3>Process-first strategy</h3>

              <div className="portal-carousel">

                {/* Slide 1 — Diagnostic report */}
                <div className="portal-slide">
                  <div className="ps-bar">
                    <span className="ps-dot r"/><span className="ps-dot y"/><span className="ps-dot g"/>
                    <span className="ps-bar-title">Diagnostic Report · Meridian Group</span>
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

                {/* Slide 2 — Cost analysis */}
                <div className="portal-slide">
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

                {/* Slide 3 — Flow Canvas (animated process mapping) */}
                <div className="portal-slide">
                  <div className="ps-bar">
                    <span className="ps-dot r"/><span className="ps-dot y"/><span className="ps-dot g"/>
                    <span className="ps-bar-title">Flow Canvas · Invoice Approval</span>
                    <span className="ps-bar-chip">Finance · Management</span>
                  </div>
                  <div className="ps-body ps-body--map">
                    <div className="pm-lane-bg pm-lane-bg--a" aria-hidden="true"/>
                    <div className="pm-lane-bg pm-lane-bg--b" aria-hidden="true"/>
                    <div className="pm-lane-bg pm-lane-bg--c" aria-hidden="true"/>
                    <div className="pm-flow">
                      <div className="pm-step" data-map-node="0">
                        <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                        <span className="pm-step-num">01</span>
                        <span className="pm-step-name">Request<br/>Raised</span>
                        <span className="pm-step-dept">Finance</span>
                        <span className="pm-step-ghost">A</span>
                      </div>
                      <div className="pm-arrow" data-map-edge="0"/>
                      <div className="pm-step pm-step--bot" data-map-node="1">
                        <span className="pm-step-bar" style={{background:'#dc2626'}}/>
                        <span className="pm-step-num">02</span>
                        <span className="pm-step-name">Manager<br/>Review</span>
                        <span className="pm-step-dept">Management</span>
                        <span className="pm-step-ghost">R</span>
                        <span className="pm-step-warn">⚠</span>
                      </div>
                      <div className="pm-arrow" data-map-edge="1"/>
                      <div className="pm-step" data-map-node="2">
                        <span className="pm-step-bar" style={{background:'#0d9488'}}/>
                        <span className="pm-step-num">03</span>
                        <span className="pm-step-name">Payment<br/>Released</span>
                        <span className="pm-step-dept">Finance</span>
                        <span className="pm-step-ghost">P</span>
                      </div>
                    </div>
                    <div className="pm-footer-strip">
                      <span className="pm-fs-badge pm-fs-badge--bot">⚠ 1 bottleneck</span>
                      <span className="pm-fs-badge pm-fs-badge--auto">2 automatable</span>
                      <span className="pm-fs-badge pm-fs-badge--time">~4h avg</span>
                    </div>
                  </div>
                </div>

                {/* Dots indicator */}
                <div className="ps-dots">
                  <span className="ps-dot-ind ps-dot-ind--active"/>
                  <span className="ps-dot-ind"/>
                  <span className="ps-dot-ind"/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Approach — flow diagram */}
      <section className="approach-section" id="approach">
        <div className="container">
          <div className="section-header section-header--center scroll-reveal">
            <div className="section-rule" />
            <div className="section-label">Our Approach</div>
            <h2 className="section-title">The modern approach to<br /><em>fixing operations</em></h2>
            <p className="section-desc">A diagnostic built around your real processes — not interviews. Every finding is financially quantified before a single change is made.</p>
          </div>

          <div className="flow-diagram scroll-reveal">
            {/* Left — client input card */}
            <div className="flow-input-card">
              <div className="flow-input-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div className="flow-input-name">You</div>
              <div className="flow-input-org">Complete the diagnostic</div>
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

            {/* Centre — Sharpin engine */}
            <div className="flow-engine">
              <div className="flow-engine-logo">Sharpin<span>.</span></div>
              <div className="flow-engine-modules">
                <div className="flow-engine-module flow-engine-module--ai">
                  <div className="flow-engine-module-avatar flow-engine-module-avatar--ai">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M12 2a2 2 0 012 2v2a2 2 0 01-2 2 2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M12 16a2 2 0 012 2v2a2 2 0 01-2 2 2 2 0 01-2-2v-2a2 2 0 012-2z"/><path d="M2 12a2 2 0 012-2h2a2 2 0 012 2 2 2 0 01-2 2H4a2 2 0 01-2-2z"/><path d="M16 12a2 2 0 012-2h2a2 2 0 012 2 2 2 0 01-2 2h-2a2 2 0 01-2-2z"/><circle cx="12" cy="12" r="2"/></svg>
                  </div>
                  <div className="flow-engine-module-text">
                    <div className="flow-engine-module-label">Diagnostic Engine</div>
                    <div className="flow-engine-module-sub">Maps processes, surfaces waste, quantifies cost</div>
                  </div>
                  <div className="flow-engine-module-tag flow-engine-module-tag--ai">AI</div>
                </div>
                <div className="flow-engine-module flow-engine-module--human">
                  <div className="flow-engine-module-avatar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </div>
                  <div className="flow-engine-module-text">
                    <div className="flow-engine-module-label">Operations Consultant</div>
                    <div className="flow-engine-module-sub">Reviews findings &amp; advises on priorities</div>
                  </div>
                  <div className="flow-engine-module-tag">Human</div>
                </div>
              </div>
              <div className="flow-engine-done">
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/><path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Report delivered in days
              </div>
            </div>

            {/* Arrow out */}
            <div className="flow-arrow flow-arrow--out">
              <svg viewBox="0 0 60 20" fill="none" width="60" height="20">
                <path d="M0 10 L50 10" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3"/>
                <path d="M44 5 L54 10 L44 15" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>

            {/* Right — outputs */}
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

      {/* Diagnostic CTA */}
      <section className="diagnostic-cta section--light" id="diagnostic">
        <div className="container">
          <div className="diagnostic-cta-content">
            <div className="diagnostic-badge">Free · No commitment · Report in days</div>
            <h2>See exactly where your<br /><strong>operations are leaking</strong></h2>
            <p>Walk through your real processes with real examples. The diagnostic surfaces every bottleneck, rework loop, and manual workaround — with the financial impact of each one made explicit.</p>
            <Link href="/diagnostic" className="btn-white" target="_blank" rel="noopener noreferrer">
              Start Process Diagnostic <ArrowIcon />
            </Link>
          </div>
          <div className="diagnostic-stats">
            <div className="diagnostic-stat scroll-reveal">
              <span className="diagnostic-stat-number">Process-first</span>
              <span className="diagnostic-stat-label">Evidence, not opinion</span>
            </div>
            <div className="diagnostic-stat scroll-reveal">
              <span className="diagnostic-stat-number">Days</span>
              <span className="diagnostic-stat-label">To your full report</span>
            </div>
            <div className="diagnostic-stat scroll-reveal">
              <span className="diagnostic-stat-number">£0</span>
              <span className="diagnostic-stat-label">No retainer, no commitment</span>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bottom-cta" id="contact">
        <div className="container">
          <p className="bottom-cta-text">
            Ready to see what&apos;s <em>really</em> slowing you down?
          </p>
          <div className="cta-buttons">
            <a href="mailto:hopektettey@gmail.com" className="btn-primary">Book Discovery Call</a>
            <a href="#services" className="btn-outline" onClick={scrollTo('services')}>Explore Services</a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mkt-footer">
        <div className="footer-content">
          <div>
            <div className="footer-brand">Sharpin<span style={{ fontStyle: 'italic', color: 'var(--accent-mid)' }}>.</span></div>
            <p className="footer-tagline">Evidence-based process diagnostics and operations transformation — for scaling companies, M&amp;A integration, and private equity portfolios.</p>
          </div>
          <div>
            <h4>Services</h4>
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
              <li><a href="#diagnostic" onClick={scrollTo('diagnostic')}>Diagnostic</a></li>
              <li><a href="#contact" onClick={scrollTo('contact')}>Contact</a></li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              <li><a href="mailto:hopektettey@gmail.com">hopektettey@gmail.com</a></li>
              <li>London, United Kingdom</li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p suppressHydrationWarning>&copy; {new Date().getFullYear()} Sharpin. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}