'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import HeroCanvas from '@/components/marketing/HeroCanvas';
import './marketing.css';

const ArrowIcon = () => (
  <svg className="arrow-icon" viewBox="0 0 16 16" fill="none">
    <path d="M3.5 8h9m0 0L9 4.5M12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ── "Sound Familiar?" pain-point recognition section ── */
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
    detail: 'The software was meant to fix everything. Instead, the team built workarounds on top of workarounds. You\'re paying for licenses nobody uses properly.',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>,
    headline: 'Growing headcount but not growing output',
    detail: 'You keep hiring, but throughput barely shifts. The bottleneck isn\'t people. It\'s the process underneath them.',
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

function SignalsCarousel({ scrollTo }) {
  const pairs = [
    [signals[0], signals[1]],
    [signals[2], signals[3]],
    [signals[4], signals[5]],
  ];
  const [active, setActive] = useState(0);
  const [exiting, setExiting] = useState(-1);
  const timerRef = useRef(null);

  const startTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive((prev) => {
        const next = (prev + 1) % pairs.length;
        setExiting(prev);
        setTimeout(() => setExiting(-1), 500);
        return next;
      });
    }, 4000);
  };

  const goTo = (idx) => {
    if (idx === active) return;
    clearInterval(timerRef.current);
    setExiting(active);
    setTimeout(() => { setActive(idx); setExiting(-1); }, 500);
  };

  useEffect(() => {
    startTimer();
    return () => clearInterval(timerRef.current);
  }, [pairs.length]);

  const accentColors = ['var(--accent)', 'var(--gold)'];

  return (
    <section className="signals-section">
      <div className="container">
        <div className="section-header scroll-reveal">
          <div className="section-label">Sound familiar?</div>
          <h2 className="section-title">The Problems That Quietly Drain <strong>Your Profitability</strong></h2>
        </div>

        <div className="signals-carousel">
          {pairs.map((pair, pIdx) => (
            <div
              key={pIdx}
              className={`signal-pair${pIdx === active ? ' active' : ''}${pIdx === exiting ? ' exiting' : ''}`}
            >
              {pair.map((s, sIdx) => (
                <div key={s.headline} className="signal-card">
                  <div className="signal-card-accent" style={{ background: accentColors[sIdx % 2] }} />
                  <div className="signal-card-inner">
                    <div className="signal-icon-wrap" style={{ '--accent-c': accentColors[sIdx % 2] }}>
                      {s.icon}
                    </div>
                    <h3 className="signal-headline">{s.headline}</h3>
                    <a href="#approach" className="signal-cta" onClick={scrollTo('approach')}>
                      See how we solve this
                      <svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10m0 0L9.5 4.5M13 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="signals-dots">
          {pairs.map((_, i) => (
            <button
              key={i}
              className={`signals-dot${i === active ? ' active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Show problems ${i * 2 + 1} and ${i * 2 + 2}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Services segments component ── */
const segments = [
  {
    color: 'teal',
    label: 'Scaling Mid-Market',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>,
    tagline: 'Growing companies, breaking processes',
    outcome: 'We surface exactly where your operations are slowing you down, and what fixing them is worth.',
  },
  {
    color: 'indigo',
    label: 'M&A Integration',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="18" r="3" /><circle cx="16" cy="6" r="3" /><path d="M8 15V9a6 6 0 016-6" /><path d="M16 9v6a6 6 0 01-6 6" /></svg>,
    tagline: 'Structure from Day 1, not Day 100',
    outcome: 'We bring operational clarity to post-merger complexity before it compounds into something harder to fix.',
  },
  {
    color: 'purple',
    label: 'Private Equity Value Creation',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg>,
    tagline: 'From acquisition baseline to exit-ready',
    outcome: 'Operational excellence that shows up in the multiple, from Day 1 post-acquisition to the data room.',
  },
  {
    color: 'gold',
    label: 'High-stakes Operational Events',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
    tagline: 'Carve-outs, ERP, VC-backed scale-ups',
    outcome: 'High-stakes operational moments with hard deadlines. We provide the structure when there is no time to improvise.',
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
          <a href="#contact" className={`seg-card-cta seg-card-cta--${s.color}`}>
            Get in touch <ArrowIcon />
          </a>
        </div>
      ))}
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
    return () => observer.disconnect();
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    closeMenu();
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
            {sessionUser?.email ? (
              <li><Link href="/portal" onClick={closeMenu}>Client Login</Link></li>
            ) : (
              <li><Link href="/portal" onClick={closeMenu}>Client Login</Link></li>
            )}
            <li><a href="#contact" className="cta-nav" onClick={scrollTo('contact')}>Get Started</a></li>
            {sessionUser?.email && (
              <li><button type="button" className="nav-signout-btn" onClick={() => { closeMenu(); sessionSignOut(); }}>Sign Out</button></li>
            )}
          </ul>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <HeroCanvas />
        <div className="hero-overlay" />

        <div className="hero-main">
          <div className="container">
            <div className="hero-content">
              <div className="hero-label">Unlock Operating Leverage</div>
              <h1>Do More. <strong>With Less Friction.</strong></h1>
              <p className="hero-subtitle">
                We find the hidden capacity in your operations by fixing broken processes and deploying the right technology so your team delivers more.
              </p>
              <div className="hero-cta-row">
                <Link href="/diagnostic" className="btn-primary" target="_blank" rel="noopener noreferrer">
                  Start Free Diagnostic <ArrowIcon />
                </Link>
                <a href="#comparison" className="btn-secondary" onClick={scrollTo('comparison')}>
                  See How We&apos;re Different
                </a>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* Services  -  immediately below hero */}
      <section className="services-section" id="services">
        <div className="container">
          <div className="section-header scroll-reveal">
            <div className="section-label">What We Do</div>
            <h2 className="section-title">Wherever the Complexity Lives,<br /><strong>We Work There</strong></h2>
            
          </div>
          <ServicesSegments />
        </div>
      </section>

      {/* Sound Familiar - Sliding carousel */}
      <SignalsCarousel scrollTo={scrollTo} />
      <section className="comparison-section" id="comparison">
        <div className="container">
          <div className="section-header">
            <div className="section-label">The Difference</div>
            <h2 className="section-title">Don&apos;t Automate the Chaos.<br /><strong>Eliminate It.</strong></h2>
            <p className="section-desc">Most digital transformations fail because they digitise broken processes. We fix the process first.</p>
          </div>

          <div className="comp-panels">
            {/* Old Way */}
            <div className="comp-panel old scroll-reveal">
              <div className="comp-panel-label">The Old Way</div>
              <h3>Technology-First Approach</h3>
              <div className="mockup">
                <div className="mockup-bar">
                  <div className="mockup-dot r" /><div className="mockup-dot y" /><div className="mockup-dot g" />
                  <div className="mockup-bar-title">operations-tools.xlsx</div>
                </div>
                <div className="mockup-body">
                  <div className="chaos-stack">
                    <div className="chaos-card" style={{ top: 0, left: 0, transform: 'rotate(-2deg)', zIndex: 3, width: '85%' }}>
                      <div className="cc-icon">&#128231;</div>
                      <div className="cc-title">47 unread threads</div>
                      <div className="cc-sub">RE: RE: RE: Process update</div>
                      <div className="chaos-badge warn">3 days old</div>
                    </div>
                    <div className="chaos-card" style={{ top: 55, left: '8%', transform: 'rotate(1.5deg)', zIndex: 4, width: '88%' }}>
                      <div className="cc-icon">&#128202;</div>
                      <div className="cc-title">Q3 tracker.xlsx</div>
                      <div className="cc-sub">Last edited: 6 weeks ago</div>
                      <div className="chaos-badge stale">Version 14</div>
                    </div>
                    <div className="chaos-card" style={{ top: 110, left: '2%', transform: 'rotate(1deg)', zIndex: 5, width: '82%' }}>
                      <div className="cc-icon">&#9888;&#65039;</div>
                      <div className="cc-title">CRM sync failed</div>
                      <div className="cc-sub">Salesforce &rarr; SAP pipeline</div>
                      <div className="chaos-badge err">Error</div>
                    </div>
                    <div className="chaos-card" style={{ top: 165, left: '5%', transform: 'rotate(-1.5deg)', zIndex: 2, width: '90%' }}>
                      <div className="cc-icon">&#128176;</div>
                      <div className="cc-title">Costly platform lock-in</div>
                      <div className="cc-sub">Multi-year contract, rising fees</div>
                      <div className="chaos-badge warn">Lock-in: 2 yrs</div>
                    </div>
                    <div className="chaos-card" style={{ top: 220, left: '4%', transform: 'rotate(0.5deg)', zIndex: 6, width: '86%' }}>
                      <div className="cc-icon">&#128260;</div>
                      <div className="cc-title">Migration blocked</div>
                      <div className="cc-sub">Vendor dependency on 4 APIs</div>
                      <div className="chaos-badge err">Overdue</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI-First */}
            <div className="comp-panel ai scroll-reveal">
              <div className="comp-panel-label">The Hype Trap</div>
              <h3>&quot;How Can We Deploy AI?&quot;</h3>
              <div className="mockup">
                <div className="mockup-bar">
                  <div className="mockup-dot r" /><div className="mockup-dot y" /><div className="mockup-dot g" />
                  <div className="mockup-bar-title">ai-strategy-meeting.slack</div>
                </div>
                <div className="mockup-body">
                  <div className="ai-chat-mock">
                    <div className="ai-chat-bubble user">
                      <div className="bubble-tag">Executive</div>
                      &quot;We need to deploy AI across the business. Our competitors are doing it.&quot;
                    </div>
                    <div className="ai-chat-bubble bot">
                      <div className="bubble-tag">AI Vendor</div>
                      &quot;Great! Our platform can automate everything. Just connect your data and...&quot;
                    </div>
                    <div className="ai-chat-bubble user">
                      <div className="bubble-tag">Executive</div>
                      &quot;What processes should we start with?&quot;
                    </div>
                    <div className="ai-chat-bubble bot">
                      <div className="bubble-tag">AI Vendor</div>
                      &quot;All of them! Our AI handles it all. ROI in 3 months guaranteed.&quot;
                    </div>
                    <div className="ai-warn-row">
                      <span className="warn-icon">&#9888;&#65039;</span>
                      No process mapping. No baseline metrics. No understanding of what&apos;s actually broken.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* The Right Way */}
            <div className="comp-panel new scroll-reveal">
              <div className="comp-panel-label">The Sharpin Way</div>
              <h3>Process-First Strategy</h3>
              <div className="mockup">
                <div className="mockup-bar">
                  <div className="mockup-dot r" /><div className="mockup-dot y" /><div className="mockup-dot g" />
                  <div className="mockup-bar-title">Sharpin Client Login</div>
                </div>
                <div className="mockup-body">
                  <div className="dash-tabs">
                    <div className="dash-tab active">Overview</div>
                    <div className="dash-tab">Processes</div>
                    <div className="dash-tab">Roadmap</div>
                  </div>
                  <div className="dash-metrics">
                    <div className="dash-metric">
                      <span className="dash-metric-val">47 &rarr; 14</span>
                      <span className="dash-metric-lbl">Cycle days</span>
                    </div>
                    <div className="dash-metric">
                      <span className="dash-metric-val">&pound;127K</span>
                      <span className="dash-metric-lbl">Annual savings</span>
                    </div>
                    <div className="dash-metric">
                      <span className="dash-metric-val">82%</span>
                      <span className="dash-metric-lbl">Automation ready</span>
                    </div>
                  </div>
                  <div className="dash-row">
                    <span className="dash-dot green" />
                    <span className="dash-row-name">Invoice processing</span>
                    <span className="dash-tag">Optimised</span>
                    <span className="dash-row-val">-70% time</span>
                  </div>
                  <div className="dash-row">
                    <span className="dash-dot green" />
                    <span className="dash-row-name">Client onboarding</span>
                    <span className="dash-tag">Optimised</span>
                    <span className="dash-row-val">-55% time</span>
                  </div>
                  <div className="dash-row">
                    <span className="dash-dot amber" />
                    <span className="dash-row-name">Vendor approvals</span>
                    <span className="dash-row-val">In progress</span>
                  </div>
                  <div className="dash-row">
                    <span className="dash-dot red" />
                    <span className="dash-row-name">Quarterly reporting</span>
                    <span className="dash-row-val">3 bottlenecks</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Approach */}
      <section className="approach-section" id="approach">
        <div className="container">
          <div className="section-header scroll-reveal">
            <div className="section-label">Our Approach</div>
            <h2 className="section-title">How We <strong>Transform Operations</strong></h2>
            <p className="section-desc">Every engagement is structured to free up capacity &ndash; so your team does more, not more of the same.</p>
          </div>

          <div className="flow-grid scroll-reveal">
            <div className="flow-node teal" onClick={() => scrollTo('diagnostic')}>
              <div className="flow-node-accent" />
              <div className="flow-node-icon teal">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              </div>
              <h4>Discover</h4>
              <p>Map every process, measure friction, surface hidden costs</p>
              <span className="flow-node-tag">Full Visibility</span>
              <span className="flow-node-tag">AI-Assisted Analysis</span>
            </div>

            <div className="flow-node-connector conn-dr">
              <svg className="conn-h" viewBox="0 0 60 20"><path d="M0,10 L50,10" className="flow-path" stroke="#3d8ea6" strokeWidth="2" fill="none" /><polygon points="50,5 60,10 50,15" fill="#3d8ea6" /><circle r="3" fill="#3d8ea6" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M0,10 L60,10" /></circle></svg>
              <svg className="conn-v" viewBox="0 0 20 40"><path d="M10,0 L10,30" className="flow-path" stroke="#3d8ea6" strokeWidth="2" fill="none" /><polygon points="5,30 10,40 15,30" fill="#3d8ea6" /><circle r="3" fill="#3d8ea6" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M10,0 L10,40" /></circle></svg>
            </div>

            <div className="flow-node purple" onClick={() => scrollTo('diagnostic')}>
              <div className="flow-node-accent" />
              <div className="flow-node-icon purple">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
              </div>
              <h4>Repair</h4>
              <p>Eliminate waste and fix broken processes before automating</p>
              <span className="flow-node-tag">Clean Processes</span>
            </div>

            <div className="flow-node-connector conn-rr">
              <svg className="conn-h-horiz" viewBox="0 0 60 20"><path d="M0,10 L50,10" className="flow-path" stroke="#7c3aed" strokeWidth="2" fill="none" /><polygon points="50,5 60,10 50,15" fill="#7c3aed" /><circle r="3" fill="#7c3aed" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M0,10 L60,10" /></circle></svg>
              <svg className="conn-h-vert" viewBox="0 0 20 60"><path d="M10,0 L10,50" className="flow-path" stroke="#7c3aed" strokeWidth="2" fill="none" /><polygon points="5,50 10,60 15,50" fill="#7c3aed" /><circle r="3" fill="#7c3aed" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M10,0 L10,60" /></circle></svg>
              <svg className="conn-v" viewBox="0 0 20 40"><path d="M10,0 L10,30" className="flow-path" stroke="#7c3aed" strokeWidth="2" fill="none" /><polygon points="5,30 10,40 15,30" fill="#7c3aed" /><circle r="3" fill="#7c3aed" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M10,0 L10,40" /></circle></svg>
            </div>

            <div className="flow-node gold" onClick={() => scrollTo('diagnostic')}>
              <div className="flow-node-accent" />
              <div className="flow-node-icon gold">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              </div>
              <h4>Redirect</h4>
              <p>Channel freed capacity into the work that moves the needle</p>
              <span className="flow-node-tag">Freed Capacity</span>
            </div>

            <div className="flow-node-connector conn-rc">
              <svg className="conn-h-horiz" viewBox="0 0 60 20"><path d="M0,10 L50,10" className="flow-path" stroke="#b8976a" strokeWidth="2" fill="none" /><polygon points="50,5 60,10 50,15" fill="#b8976a" /><circle r="3" fill="#b8976a" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M0,10 L60,10" /></circle></svg>
              <svg className="conn-h-vert" viewBox="0 0 60 20"><path d="M60,10 L10,10" className="flow-path" stroke="#b8976a" strokeWidth="2" fill="none" /><polygon points="10,5 0,10 10,15" fill="#b8976a" /><circle r="3" fill="#b8976a" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M60,10 L0,10" /></circle></svg>
              <svg className="conn-v" viewBox="0 0 20 40"><path d="M10,0 L10,30" className="flow-path" stroke="#b8976a" strokeWidth="2" fill="none" /><polygon points="5,30 10,40 15,30" fill="#b8976a" /><circle r="3" fill="#b8976a" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M10,0 L10,40" /></circle></svg>
            </div>

            <div className="flow-node green" onClick={() => scrollTo('diagnostic')}>
              <div className="flow-node-accent" />
              <div className="flow-node-icon green">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" /><circle cx="12" cy="12" r="4" /></svg>
              </div>
              <h4>Compound</h4>
              <p>Implement, track real impact. Every fix fuels the next</p>
              <span className="flow-node-tag">Compounding Gains</span>
            </div>

            <div className="flow-node-connector conn-cd">
              <svg className="conn-h" viewBox="0 0 20 60"><path d="M10,60 L10,10" className="flow-path" stroke="#16a34a" strokeWidth="2" fill="none" /><polygon points="5,10 10,0 15,10" fill="#16a34a" /><circle r="3" fill="#16a34a" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M10,60 L10,0" /></circle></svg>
              <svg className="conn-v" viewBox="0 0 20 40"><path d="M10,0 L10,30" className="flow-path" stroke="#16a34a" strokeWidth="2" fill="none" /><polygon points="5,30 10,40 15,30" fill="#16a34a" /><circle r="3" fill="#16a34a" opacity="0.85"><animateMotion dur="1.2s" repeatCount="indefinite" path="M10,40 L10,0" /></circle></svg>
            </div>

            <div className="flow-return-line">
              <svg viewBox="0 0 800 120" preserveAspectRatio="none">
                <path d="M700,0 L700,100 L100,100 L100,0" className="flow-path" stroke="#86efac" strokeWidth="1.2" fill="none" />
                <polygon points="96,5 100,0 104,5" fill="#86efac" opacity="0.8" />
                <circle r="3" fill="#86efac" opacity="0.9"><animateMotion dur="3s" repeatCount="indefinite" path="M700,0 L700,100 L100,100 L100,0" /></circle>
              </svg>
              <span className="flow-return-tag">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 105.64-11.36L1 10" /></svg>
                Continuous Cycle
              </span>
            </div>

            <div className="flow-return-label-mobile">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 105.64-11.36L1 10" /></svg>
              <span>Back to Discover</span>
            </div>
          </div>

        </div>
      </section>

      {/* Diagnostic CTA */}
      <section className="diagnostic-cta" id="diagnostic">
        <div className="container">
          <div className="diagnostic-badge">Evidence-Based Analysis</div>
          <h2>Discover What&apos;s <strong>Actually Broken</strong></h2>
          <p>Walk through your real processes with real examples. Our diagnostic reveals the rework, bottlenecks, and manual workarounds that are quietly consuming your team&apos;s capacity.</p>
          <div className="diagnostic-stats">
            <div className="diagnostic-stat scroll-reveal"><span className="diagnostic-stat-number">Hours</span><span className="diagnostic-stat-label">Not months</span></div>
            <div className="diagnostic-stat scroll-reveal"><span className="diagnostic-stat-number">Evidence-led</span><span className="diagnostic-stat-label">Real data, real costs</span></div>
            <div className="diagnostic-stat scroll-reveal"><span className="diagnostic-stat-number">Free</span><span className="diagnostic-stat-label">Full report included</span></div>
          </div>
          <Link href="/diagnostic" className="btn-white" target="_blank" rel="noopener noreferrer">
            Start Process Diagnostic <ArrowIcon />
          </Link>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bottom-cta" id="contact">
        <div className="container">
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
            <div className="footer-brand">Sharpin</div>
            <p className="footer-tagline">Evidence-based process diagnostics and operations transformation. We work across scaling companies, M&amp;A integration, private equity portfolios, and high-stakes operational events.</p>
          </div>
          <div>
            <h4>Services</h4>
            <ul>
              <li><a href="#services" onClick={scrollTo('services')}>Scaling Mid-Market</a></li>
              <li><a href="#services" onClick={scrollTo('services')}>M&amp;A Integration</a></li>
              <li><a href="#services" onClick={scrollTo('services')}>Private Equity Value Creation</a></li>
              <li><a href="#services" onClick={scrollTo('services')}>High-stakes Operational Events</a></li>

            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><a href="#approach" onClick={scrollTo('approach')}>Approach</a></li>
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
