'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useDiagnostic } from './DiagnosticContext';
import { useDiagnosticNav } from './DiagnosticNavContext';
import { MAP_ONLY_PROMPTS, COMPREHENSIVE_PROMPTS } from '@/lib/diagnostic/guidedPrompts';
import { PROCESSES as processesConst } from '@/lib/diagnostic/processData';

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

export default function GuidedChatScreen() {
  const {
    processData,
    updateProcessData,
    goToScreen,
    diagnosticMode,
    teamMode,
  } = useDiagnostic();

  const prompts = COMPREHENSIVE_PROMPTS;
  const skipProcessPrompt = teamMode && processData?.processName?.trim();
  const [currentIndex, setCurrentIndex] = useState(skipProcessPrompt ? 1 : 0);
  const [messages, setMessages] = useState([]);
  const [collectedData, setCollectedData] = useState(() => ({ ...processData }));
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const { registerNav } = useDiagnosticNav();

  const isComplete = currentIndex >= prompts.length;
  const currentPrompt = !isComplete ? prompts[currentIndex] : null;
  const showProcessVisual = currentPrompt?.id === 'process';

  const PROCESSES = processesConst;

  // Initial assistant message
  useEffect(() => {
    if (messages.length === 0 && prompts.length > 0) {
      const startIdx = skipProcessPrompt ? 1 : 0;
      const first = prompts[startIdx];
      const q = typeof first.question === 'function'
        ? first.question(collectedData)
        : first.question;
      setMessages([{ role: 'assistant', content: q, promptId: first.id }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAnswer = useCallback((text) => {
    if (!currentPrompt) return;
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const partial = currentPrompt.extract(trimmed, currentPrompt, collectedData);
    const merged = deepMerge(collectedData, partial);
    const valid = currentPrompt.validate ? currentPrompt.validate(merged) : true;

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
    ]);

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
    setCurrentIndex((i) => i + 1);

    if (currentIndex + 1 < prompts.length) {
      const next = prompts[currentIndex + 1];
      const q = typeof next.question === 'function' ? next.question(merged) : next.question;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: q, promptId: next.id },
      ]);
    }
  }, [currentPrompt, currentIndex, prompts, collectedData, updateProcessData]);

  const goToMapSteps = useCallback(() => {
    updateProcessData(collectedData);
    goToScreen(2);
  }, [collectedData, updateProcessData, goToScreen]);

  const onBack = useCallback(() => {
    goToScreen(teamMode ? -2 : 0);
  }, [goToScreen, teamMode]);

  // Register nav: Back only; user accepts next stage via chat chip
  useEffect(() => {
    registerNav({ onBack });
    return () => registerNav(null);
  }, [registerNav, onBack]);

  return (
    <div className="guided-chat-screen">
      <div className="guided-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`s7-msg s7-msg-${m.role}`}>
            {m.role === 'assistant' && (
              <div className="sharp-avatar" title="Sharp">S</div>
            )}
            <div className="s7-msg-bubble">{m.content}</div>
          </div>
        ))}
        {showProcessVisual && (
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
        )}
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

      {!isComplete && currentPrompt && !showProcessVisual && (
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
