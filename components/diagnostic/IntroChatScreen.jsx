'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useDiagnostic } from './DiagnosticContext';
import { useDiagnosticNav } from './DiagnosticNavContext';
import { PROCESSES } from '@/lib/diagnostic';
import {
  COMPREHENSIVE_PROMPTS,
  nextPromptIndexAfter,
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
  } = useDiagnostic();

  const [phase, setPhase] = useState('mode'); // 'mode' | 'process'
  const [processIndex, setProcessIndex] = useState(0);
  const [messages, setMessages] = useState([]);
  const [collectedData, setCollectedData] = useState(() => ({ ...processData }));
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const { registerNav } = useDiagnosticNav();

  const processPrompts = COMPREHENSIVE_PROMPTS;
  const currentProcessPrompt = processPrompts[processIndex];
  const processComplete = processIndex >= processPrompts.length;

  const isComplete = phase === 'process' && processComplete;

  const segmentGreetings = {
    ma: "Hello, I'm Reina! I'll help you build your Day 1 integration baseline: mapping the target company's processes and surfacing where complexity will compound if left unaddressed. How deep would you like to go?",
    pe: "Hello, I'm Reina! I'll help you identify value creation opportunities across your portfolio company's operations: quantifying the cost of bottlenecks and prioritising the highest-ROI fixes. How deep would you like to go?",
    highstakes: "Hello, I'm Reina! With high-stakes timelines in mind, I'll help you map and prioritise the processes that matter most before your deadline. How deep would you like to go?",
    scaling: "Hello, I'm Reina! I'll help you find exactly where your operations are slowing you down as you scale, and what fixing them is worth. How deep would you like to go?",
  };

  // Initial message — start directly with mode selection
  useEffect(() => {
    if (messages.length === 0) {
      setPendingPath('individual');
      const greeting = segmentGreetings[processData?.segment] || "Hello, I'm Reina! I'll help you map your process and find where time and money are leaking. How deep would you like to go?";
      setMessages([{ role: 'assistant', content: greeting, promptId: 'mode' }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleModeAnswer = useCallback((mode) => {
    setDiagnosticMode(mode);
    const label = mode === 'comprehensive' ? 'Full Audit' : 'Map Process Only';
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: label },
      { role: 'assistant', content: "Great. Let's define your process.", promptId: 'transition' },
    ]);
    setPhase('process');
    const first = processPrompts[0];
    const q = typeof first.question === 'function' ? first.question(collectedData) : first.question;
    setMessages((prev) => [...prev, { role: 'assistant', content: q, promptId: first.id }]);
  }, [setDiagnosticMode, processPrompts, collectedData]);

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

    const nextIndex = nextPromptIndexAfter(processIndex, merged, processPrompts);
    setProcessIndex(nextIndex);

    if (nextIndex < processPrompts.length) {
      const next = processPrompts[nextIndex];
      const q = typeof next.question === 'function' ? next.question(merged) : next.question;
      setMessages((prev) => [...prev, { role: 'assistant', content: q, promptId: next.id }]);
    }
  }, [currentProcessPrompt, processIndex, processPrompts, collectedData, updateProcessData]);

  const handleAnswer = useCallback((text) => {
    if (phase === 'mode') { /* handled by renderModeVisual buttons */ }
    else handleProcessAnswer(text);
  }, [phase, handleProcessAnswer]);

  const goToMapSteps = useCallback(() => {
    updateProcessData(collectedData);
    goToScreen(2);
  }, [collectedData, updateProcessData, goToScreen]);

  const onBack = useCallback(() => {
    if (phase === 'process' && processIndex === 0) {
      setPhase('mode');
      setProcessIndex(0);
      setMessages((prev) => prev.slice(0, 1)); // keep opening mode question
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

  const currentPrompt = processComplete ? null : currentProcessPrompt;

  const renderModeVisual = () => (
    <>
      <div className="welcome-paths">
        <button type="button" className="welcome-path-btn welcome-path-btn-individual" onClick={() => handleModeAnswer('comprehensive')}>
          <span className="welcome-path-btn-label">Full Audit</span>
          <span className="welcome-path-btn-meta">Map the process steps and size the cost &amp; impact. A manager completes the financial model afterwards — you&apos;ll get a shareable link.</span>
          <span className="welcome-path-btn-cta">Start →</span>
        </button>
        <button type="button" className="welcome-path-btn welcome-path-btn-team" onClick={() => handleModeAnswer('map-only')}>
          <span className="welcome-path-btn-label">Map Process Only</span>
          <span className="welcome-path-btn-meta">Map the process steps without cost sizing. Good for a quick visual of how work flows.</span>
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
      <div className="process-list">
        {PROCESSES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`process-list-item${collectedData.processType === p.id ? ' selected' : ''}`}
            onClick={() => handleAnswer(p.name)}
          >
            {p.name}
          </button>
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

  const showModeVisual = phase === 'mode';
  const showProcessVisual = phase === 'process' && currentProcessPrompt?.id === 'process';

  return (
    <div className="guided-chat-screen intro-chat-screen">
      <div className="guided-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`s7-msg s7-msg-${m.role}`}>
            {m.role === 'assistant' && (
              <div className="sharp-avatar" title="Reina">R</div>
            )}
            <div className="s7-msg-bubble">{m.content}</div>
          </div>
        ))}
        {showModeVisual && renderModeVisual()}
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

      {!isComplete && currentPrompt && !showModeVisual && !showProcessVisual && (
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
