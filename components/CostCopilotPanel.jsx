'use client';

import { useState, useRef, useEffect } from 'react';

export default function CostCopilotPanel({ open, onClose, reportId, mode, getState }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I can help you interpret the cost figures in this report. Ask me anything — e.g. \"Why is the annual cost so high?\" or \"What's driving the savings estimate?\"" },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const state = getState?.() || {};
      const res = await fetch('/api/cost-copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, mode, question: text, context: state }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: 'assistant', content: data.answer || 'No response.' }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, I could not get an answer. Please try again.' }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error. Please check your connection and try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="cost-copilot-overlay" onClick={onClose} role="dialog" aria-modal aria-label="Cost co-pilot">
      <div className="cost-copilot-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cost-copilot-header">
          <div className="cost-copilot-header-left">
            <div className="sharp-avatar sharp-avatar-sm">R</div>
            <span className="cost-copilot-title">Cost Co-pilot</span>
          </div>
          <button type="button" className="cost-copilot-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="cost-copilot-messages">
          {messages.map((m, i) => (
            <div key={i} className={`cost-copilot-msg cost-copilot-msg--${m.role}`}>
              {m.role === 'assistant' && <div className="sharp-avatar sharp-avatar-sm">R</div>}
              <div className="cost-copilot-bubble">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="cost-copilot-msg cost-copilot-msg--assistant">
              <div className="sharp-avatar sharp-avatar-sm">R</div>
              <div className="cost-copilot-bubble cost-copilot-bubble--typing">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="cost-copilot-input-row">
          <input
            ref={inputRef}
            type="text"
            className="cost-copilot-input"
            placeholder="Ask about the cost figures…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={loading}
          />
          <button type="button" className="cost-copilot-send" onClick={send} disabled={loading || !input.trim()} aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
