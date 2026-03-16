'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useDiagnostic } from './DiagnosticContext';
import { useDiagnosticNav } from './DiagnosticNavContext';
import TeamAuthGate from './TeamAuthGate';
import { PROCESSES } from '@/lib/diagnostic';
import {
  INTRO_PROMPTS,
  COMPREHENSIVE_PROMPTS,
} from '@/lib/diagnostic/guidedPrompts';

function deepMerge(target, source) {
  const out = { ...target };
  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = target[k];
    if (typeof sv === 'object' && sv !== null && !Array.isArray(sv) && typeof tv === 'object' && tv !== null && !Array.isArray(tv)) {
      out[k] = deepMerge(tv, sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}

export default function IntroChatScreen() {
  const {
    processData,
    updateProcessData,
    goToScreen,
    setPendingPath,
    setDiagnosticMode,
    setTeamMode,
    setAuthUser,
  } = useDiagnostic();

  const [phase, setPhase] = useState('intro'); // 'intro' | 'process'
  const [showTeamAuth, setShowTeamAuth] = useState(false);
  const [processIndex, setProcessIndex] = useState(0);
  const [messages, setMessages] = useState([]);
  const [collectedData, setCollectedData] = useState(() => ({ ...processData }));
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const { registerNav } = useDiagnosticNav();

  const introPrompts = INTRO_PROMPTS;
  const processPrompts = COMPREHENSIVE_PROMPTS;
  const currentIntroPrompt = introPrompts[0];
  const currentProcessPrompt = processPrompts[processIndex];
  const processComplete = processIndex >= processPrompts.length;

  const isComplete = phase === 'process' && processComplete;

  // Initial message
  useEffect(() => {
    if (messages.length === 0 && currentIntroPrompt) {
      const q = typeof currentIntroPrompt.question === 'function'
        ? currentIntroPrompt.question(collectedData)
        : currentIntroPrompt.question;
      setMessages([{ role: 'assistant', content: q, promptId: currentIntroPrompt.id }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleIntroAnswer = useCallback((text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !currentIntroPrompt) return;

    const partial = currentIntroPrompt.extract(trimmed, currentIntroPrompt);
    const merged = deepMerge(collectedData, partial);

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setCollectedData(merged);

    if (currentIntroPrompt.id === 'path') {
      if (merged.path === 'team') {
        setPendingPath('team');
        setTeamMode(true);
        setDiagnosticMode('process');
        setShowTeamAuth(true);
        return;
      }
      setPendingPath('individual');
      setDiagnosticMode('process');
      setPhase('process');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Great. Let's define your process.", promptId: 'transition' },
      ]);
      const first = processPrompts[0];
      const q = typeof first.question === 'function' ? first.question(merged) : first.question;
      setMessages((prev) => [...prev, { role: 'assistant', content: q, promptId: first.id }]);
    }
  }, [currentIntroPrompt, collectedData, processPrompts, setPendingPath, setTeamMode, setDiagnosticMode]);

  const handleProcessAnswer = useCallback((text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !currentProcessPrompt) return;

    const partial = currentProcessPrompt.extract(trimmed, currentProcessPrompt, collectedData);
    const merged = deepMerge(collectedData, partial);
    const valid = currentProcessPrompt.validate ? currentProcessPrompt.validate(merged) : true;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);

    if (!valid) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Could you give a bit more detail? I didn't quite catch that.", promptId: 'retry' },
      ]);
      return;
    }

    setCollectedData(merged);
    updateProcessData(merged);
    setInput('');
    setProcessIndex((i) => i + 1);

    if (processIndex + 1 < processPrompts.length) {
      const next = processPrompts[processIndex + 1];
      const q = typeof next.question === 'function' ? next.question(merged) : next.question;
      setMessages((prev) => [...prev, { role: 'assistant', content: q, promptId: next.id }]);
    }
  }, [currentProcessPrompt, processIndex, processPrompts, collectedData, updateProcessData]);

  const handleAnswer = useCallback((text) => {
    if (phase === 'intro') handleIntroAnswer(text);
    else handleProcessAnswer(text);
  }, [phase, handleIntroAnswer, handleProcessAnswer]);

  const goToMapSteps = useCallback(() => {
    updateProcessData(collectedData);
    goToScreen(2);
  }, [collectedData, updateProcessData, goToScreen]);

  const onBack = useCallback(() => {
    if (phase === 'process' && processIndex === 0) {
      setPhase('intro');
      setProcessIndex(0);
      setCollectedData((d) => ({ ...d, path: undefined }));
      setMessages((prev) => prev.slice(0, 1));
    } else if (phase === 'process' && processIndex > 0) {
      setProcessIndex((i) => i - 1);
      setMessages((prev) => prev.slice(0, -2));
    }
  }, [phase, processIndex]);

  const showBack = phase === 'process';

  useEffect(() => {
    registerNav(showBack ? { onBack } : null);
    return () => registerNav(null);
  }, [registerNav, showBack, onBack]);

  const currentPrompt = phase === 'intro' ? currentIntroPrompt : (processComplete ? null : currentProcessPrompt);

  // Path selection: welcome-path cards (original Screen0Intro visuals)
  const renderPathVisual = () => (
    <>
    <div className="welcome-paths">
      <button type="button" className="welcome-path-btn welcome-path-btn-individual" onClick={() => handleAnswer('Process Map')}>
        <span className="welcome-path-btn-label">Process Map</span>
        <span className="welcome-path-btn-meta">Map and measure a process flow. One person leads — hand off to colleagues to fill in steps they know.</span>
        <span className="welcome-path-btn-cta">Start →</span>
      </button>
      <button type="button" className="welcome-path-btn welcome-path-btn-team" onClick={() => handleAnswer('Team Alignment')}>
        <span className="welcome-path-btn-label">Team Alignment</span>
        <span className="welcome-path-btn-meta team-meta-italic">Do we all see this process the same way?</span>
        <span className="welcome-path-btn-meta team-meta-extra">Each person maps the process independently. The AI compares responses to reveal where your team&apos;s understanding diverges.</span>
        <span className="welcome-path-btn-cta">Start →</span>
      </button>
    </div>
    <div className="welcome-need">
      <span className="welcome-need-item">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8 6 12 14 4" />
        </svg>
        Last week&apos;s calendar
      </span>
      <span className="welcome-need-item">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8 6 12 14 4" />
        </svg>
        A recent example to reference
      </span>
      <span className="welcome-need-item">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8 6 12 14 4" />
        </svg>
        12–15 minutes
      </span>
    </div>
    </>
  );

  const renderProcessVisual = () => (
    <>
      <div className="process-grid">
        {PROCESSES.map((p) => (
          <div
            key={p.id}
            className={`process-card ${collectedData.processType === p.id ? 'selected' : ''}`}
            onClick={() => handleAnswer(p.name)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnswer(p.name)}
            role="button"
            tabIndex={0}
          >
            <div className="process-icon" dangerouslySetInnerHTML={{ __html: p.icon }} />
            <div className="process-name">{p.name}</div>
          </div>
        ))}
      </div>
      <div className="form-group guided-chat-custom-process form-group-mt-md">
        <label>Or describe your own:</label>
        <div className="guided-chat-input-row">
          <input
            type="text"
            placeholder="e.g., Quote to Contract"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAnswer(input); } }}
          />
          <button
            type="button"
            className="s7-chat-send"
            onClick={() => handleAnswer(input)}
            disabled={!input.trim()}
            title="Submit"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );

  const handleTeamAuth = useCallback((user) => {
    setAuthUser(user);
    goToScreen(-2);
  }, [setAuthUser, goToScreen]);

  const showPathVisual = phase === 'intro' && currentIntroPrompt?.id === 'path';
  const showProcessVisual = phase === 'process' && currentProcessPrompt?.id === 'process';

  if (showTeamAuth) {
    return <TeamAuthGate onAuthenticated={handleTeamAuth} onBack={() => setShowTeamAuth(false)} />;
  }

  return (
    <div className="guided-chat-screen intro-chat-screen">
      <div className="guided-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`s7-msg s7-msg-${m.role}`}>
            {m.role === 'assistant' && (
              <div className="sharp-avatar" title="Sharp">S</div>
            )}
            <div className="s7-msg-bubble">{m.content}</div>
          </div>
        ))}
        {showPathVisual && renderPathVisual()}
        {showProcessVisual && renderProcessVisual()}
        {isComplete && (
          <div className="guided-chat-cta-wrap">
            <p className="guided-chat-cta-text">Ready to map your process steps.</p>
            <button type="button" className="guided-chat-chip guided-chat-cta-chip" onClick={goToMapSteps}>
              Yes, map my steps →
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {!isComplete && currentPrompt && !showPathVisual && !showProcessVisual && (
        <div className="guided-chat-input-area">
          {currentPrompt.chips && (
            <div className="guided-chat-chips">
              {currentPrompt.chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="guided-chat-chip"
                  onClick={() => handleAnswer(c.name)}
                >
                  {c.name}
                </button>
              ))}
              {currentPrompt.allowCustom && (
                <span className="guided-chat-chip-or">or type below</span>
              )}
            </div>
          )}
          {(currentPrompt.allowCustom || !currentPrompt.chips) && (
            <div className="guided-chat-input-row">
              <input
                type="text"
                className="s7-chat-input guided-chat-input"
                placeholder="Type your answer..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAnswer(input);
                  }
                }}
              />
              <button
                type="button"
                className="s7-chat-send"
                onClick={() => handleAnswer(input)}
                disabled={!input.trim()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
