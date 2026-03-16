'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useDiagnostic } from './DiagnosticContext';
import { DEPT_INTERNAL, DEPT_EXTERNAL } from '@/lib/diagnostic/stepConstants';
import { getFriendlyChatError, isRetryableError } from '@/lib/chat-utils';

const PREDEFINED_DEPTS = new Set([...DEPT_INTERNAL, ...DEPT_EXTERNAL]);

function isCustomDepartment(dept) {
  return dept && typeof dept === 'string' && dept.trim() && !PREDEFINED_DEPTS.has(dept.trim());
}

export default function ChatPanel() {
  const { processData, chatMessages, addChatMessage, updateProcessData, addCustomDepartment, editingReportId, editingRedesign } = useDiagnostic();

  const incompleteInfo = useMemo(() => {
    const steps = processData.steps || [];
    const handoffs = processData.handoffs || [];
    return steps
      .map((s, i) => {
        if (!s.name?.trim()) return null;
        const w = [];
        if (!s.department) w.push('department');
        if (!s.systems || s.systems.length === 0) w.push('systems');
        if (i < steps.length - 1) {
          const ho = handoffs[i] || {};
          if (!ho.method || !ho.clarity) w.push('handoff');
        }
        return w.length > 0 ? `Step ${i + 1} "${s.name}": missing ${w.join(', ')}` : null;
      })
      .filter(Boolean)
      .join('\n') || null;
  }, [processData.steps, processData.handoffs]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatProgress, setChatProgress] = useState('');
  const [chatStreamedText, setChatStreamedText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [chatError, setChatError] = useState(null);
  const lastFailedPayloadRef = useRef(null);
  const endRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let done = 0;
    const toAdd = [];
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result?.split(',')[1];
        if (base64) toAdd.push({ name: f.name, type: f.type, content: base64 });
        done++;
        if (done === files.length) setAttachments((p) => [...p, ...toAdd]);
      };
      reader.readAsDataURL(f);
    });
    e.target.value = '';
  };

  const send = async (isRetry = false) => {
    const msg = input.trim();
    if (!isRetry && ((!msg && attachments.length === 0) || loading)) return;
    const userContent = isRetry
      ? (lastFailedPayloadRef.current?.userContent || '')
      : (msg || (attachments.length > 0 ? 'Extract process steps from the attached file(s).' : ''));
    const attachmentsToSend = isRetry ? (lastFailedPayloadRef.current?.attachments || []) : [...attachments];
    if (!isRetry && (!userContent || (attachmentsToSend.length === 0 && !msg))) return;

    const userMsg = { role: 'user', content: userContent };
    if (!isRetry) {
      addChatMessage(userMsg);
      setInput('');
      setAttachments([]);
      lastFailedPayloadRef.current = { userContent, attachments: attachmentsToSend };
    }
    setChatError(null);
    setLoading(true);
    setChatStreamedText('');

    const body = JSON.stringify({
      message: userContent,
      currentSteps: processData.steps || [],
      processName: processData.processName || '',
      history: (isRetry ? chatMessages : [...chatMessages, userMsg]).map((m) => ({ role: m.role, content: m.content })),
      incompleteInfo,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      editingReportId: editingReportId || undefined,
      editingRedesign: editingRedesign || undefined,
    });

    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const resp = await fetch('/api/diagnostic-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

      const contentType = resp.headers.get('content-type') || '';
      let data;

      if (contentType.includes('text/event-stream')) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        data = {};
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message', raw = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              else if (line.startsWith('data: ')) raw = line.slice(6);
            }
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              if (event === 'progress') setChatProgress(parsed.message || '');
              else if (event === 'delta') setChatStreamedText((prev) => prev + (parsed.text || ''));
              else if (event === 'done') data = parsed;
              else if (event === 'error') throw new Error(parsed.error || 'Chat failed');
            } catch (e) { if (e.message !== 'Chat failed' && !e.message.startsWith('Chat failed')) continue; throw e; }
          }
        }
      } else {
        try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
        if (!resp.ok) throw new Error(data.error || 'Chat failed');
      }

      addChatMessage({ role: 'assistant', content: data.reply });
      if (data.actions?.length > 0) {
        const currentSteps = [...(processData.steps || [])];
        let newSteps = currentSteps;
        let newHandoffs = [...(processData.handoffs || [])];
        for (const action of data.actions) {
          if (action.name === 'replace_all_steps' && action.input.steps) {
            newSteps = action.input.steps.map((s, i) => ({
              number: i + 1,
              name: s.name || `Step ${i + 1}`,
              department: s.department || '',
              isExternal: !!s.isExternal,
              isDecision: !!s.isDecision,
              isMerge: !!s.isMerge,
              parallel: !!s.parallel,
              workMinutes: s.workMinutes ?? undefined,
              waitMinutes: s.waitMinutes ?? undefined,
              durationMinutes: s.durationMinutes ?? undefined,
              branches: s.branches || [],
              systems: s.systems || [],
              owner: s.owner || '',
              checklist: s.checklist || [],
              contributor: '',
            }));
          } else if (action.name === 'add_step') {
            const init = {
              number: newSteps.length + 1,
              name: action.input.name || '',
              department: action.input.department || '',
              isExternal: !!action.input.isExternal,
              isDecision: !!action.input.isDecision,
              isMerge: !!action.input.isMerge,
              parallel: !!action.input.parallel,
              workMinutes: action.input.workMinutes ?? undefined,
              waitMinutes: action.input.waitMinutes ?? undefined,
              durationMinutes: action.input.durationMinutes ?? undefined,
              systems: action.input.systems || [],
              branches: action.input.branches || [],
              owner: action.input.owner || '',
              checklist: action.input.checklist || [],
              contributor: '',
            };
            const afterIdx = typeof action.input.afterStep === 'number' ? action.input.afterStep : newSteps.length;
            newSteps = [...newSteps.slice(0, afterIdx), init, ...newSteps.slice(afterIdx)].map((s, i) => ({ ...s, number: i + 1 }));
          } else if (action.name === 'update_step') {
            const idx = action.input.stepNumber - 1;
            if (idx >= 0 && idx < newSteps.length) {
              const s = { ...newSteps[idx] };
              if (action.input.name !== undefined) s.name = action.input.name;
              if (action.input.department !== undefined) s.department = action.input.department;
              if (action.input.isExternal !== undefined) s.isExternal = !!action.input.isExternal;
              if (action.input.isDecision !== undefined) s.isDecision = !!action.input.isDecision;
              if (action.input.isMerge !== undefined) s.isMerge = !!action.input.isMerge;
              if (action.input.parallel !== undefined) s.parallel = !!action.input.parallel;
              if (action.input.workMinutes !== undefined) s.workMinutes = action.input.workMinutes;
              if (action.input.waitMinutes !== undefined) s.waitMinutes = action.input.waitMinutes;
              if (action.input.durationMinutes !== undefined) s.durationMinutes = action.input.durationMinutes;
              if (action.input.systems !== undefined) s.systems = action.input.systems;
              if (action.input.branches !== undefined) s.branches = action.input.branches;
              if (action.input.owner !== undefined) s.owner = action.input.owner;
              if (action.input.checklist !== undefined) s.checklist = action.input.checklist;
              newSteps = newSteps.map((p, i) => (i === idx ? s : p));
            }
          } else if (action.name === 'remove_step') {
            const idx = action.input.stepNumber - 1;
            if (idx >= 0 && idx < newSteps.length) {
              newSteps = newSteps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, number: i + 1 }));
            }
          } else if (action.name === 'set_handoff') {
            const { fromStep, method, clarity } = action.input;
            const idx = fromStep - 1;
            while (newHandoffs.length < newSteps.length - 1) newHandoffs.push({ method: '', clarity: '' });
            if (idx >= 0 && idx < newHandoffs.length) {
              newHandoffs[idx] = { ...newHandoffs[idx], ...(method ? { method } : {}), ...(clarity ? { clarity } : {}) };
            }
          } else if (action.name === 'add_custom_department') {
            const name = (action.input.name || '').trim();
            if (name && isCustomDepartment(name)) addCustomDepartment(name);
          }
        }
        if (newSteps !== currentSteps) {
          newSteps.forEach((s) => { if (isCustomDepartment(s.department)) addCustomDepartment(s.department.trim()); });
          updateProcessData({ steps: newSteps, handoffs: newHandoffs });
        }
      }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const canRetry = isRetryableError(err) && attempt < maxAttempts - 1;
        if (canRetry) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        setChatError(getFriendlyChatError(err.message));
        lastFailedPayloadRef.current = { userContent, attachments: attachmentsToSend };
      }
    }

    setLoading(false);
    setChatProgress('');
    setChatStreamedText('');
  };

  return (
    <div className="chat-panel-body">
      <div className="s7-chat-messages">
        {chatMessages.map((m, i) => (
          <div key={i} className={`s7-msg s7-msg-${m.role}`}>
            <div className="s7-msg-bubble">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="s7-msg s7-msg-assistant">
            <div className={`s7-msg-bubble ${chatStreamedText ? '' : 's7-typing'}`}>
              {chatStreamedText ? <span className="s7-typing-text">{chatStreamedText}</span> : chatProgress ? <span className="s7-typing-text">{chatProgress}</span> : <><span /><span /><span /></>}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {chatError && (
        <div className="s7-chat-error-banner">
          <span>{chatError}</span>
          <button type="button" className="s7-chat-retry-btn" onClick={() => send(true)}>
            Try again
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="s7-chat-attachments">
          {attachments.map((a, i) => (
            <span key={i} className="s7-chat-attachment-chip">
              {a.name}
              <button type="button" onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove">&times;</button>
            </span>
          ))}
        </div>
      )}
      <div className="s7-chat-input-area">
        <input type="file" ref={fileInputRef} className="s7-chat-file-input" accept="*" onChange={handleFileSelect} />
        <button type="button" className="s7-chat-attach" onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
        </button>
        <input
          type="text"
          className="s7-chat-input"
          placeholder="Describe your process flow..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={loading}
        />
        <button
          type="button"
          className="s7-chat-send"
          onClick={send}
          disabled={(!input.trim() && attachments.length === 0) || loading}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
