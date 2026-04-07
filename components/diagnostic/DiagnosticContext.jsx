'use client';

import { createContext, useContext, useCallback, useReducer, useEffect, useRef } from 'react';
import { createEmptyProcess, ensureProcessDataShape } from '@/lib/diagnostic';
import {
  TOTAL_SCREENS,
  MAP_ONLY_SCREENS,
  MAP_ONLY_STEP_LABELS,
  COMPREHENSIVE_SCREENS,
  COMPREHENSIVE_STEP_LABELS,
  SCREEN_LABELS,
  SCREEN_PHASES,
} from '@/lib/diagnostic';

const STORAGE_KEY = 'processDiagnosticProgress';
const MAX_AGE_HOURS = 24;
/** Cap persisted map-assistant history so localStorage / cloud payloads stay small */
const MAX_CHAT_MESSAGES_PERSIST = 80;

function sanitizeChatMessagesForPersist(msgs) {
  if (!Array.isArray(msgs)) return null;
  const out = [];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    const item = { role: m.role, content };
    if (Array.isArray(m.suggestions) && m.suggestions.length) {
      item.suggestions = m.suggestions.filter((s) => typeof s === 'string').slice(0, 12);
    }
    out.push(item);
  }
  return out.length ? out.slice(-MAX_CHAT_MESSAGES_PERSIST) : null;
}

// --- Reducer ---
function diagnosticReducer(state, action) {
  switch (action.type) {
    case 'SET_CURRENT_SCREEN':
      return {
        ...state,
        currentScreen: action.payload,
        maxVisitedScreen: Math.max(state.maxVisitedScreen ?? 0, action.payload),
      };
    case 'SET_PROCESS_DATA':
      return { ...state, processData: action.payload };
    case 'UPDATE_PROCESS_DATA':
      return {
        ...state,
        processData: { ...state.processData, ...action.payload },
      };
    case 'SET_COMPLETED_PROCESSES':
      return { ...state, completedProcesses: action.payload };
    case 'ADD_COMPLETED_PROCESS':
      return {
        ...state,
        completedProcesses: [...(state.completedProcesses || []), action.payload],
      };
    case 'REPLACE_COMPLETED_PROCESS':
      const idx = action.payload.index;
      const arr = [...(state.completedProcesses || [])];
      if (idx >= 0 && idx < arr.length) arr[idx] = action.payload.process;
      return { ...state, completedProcesses: arr };
    case 'SET_DIAGNOSTIC_MODE':
      return { ...state, diagnosticMode: action.payload };
    case 'SET_CUSTOM_DEPARTMENTS':
      return { ...state, customDepartments: action.payload };
    case 'ADD_CUSTOM_DEPARTMENT':
      const name = (action.payload || '').trim();
      if (!name) return state;
      const lower = name.toLowerCase();
      const existing = state.customDepartments || [];
      if (existing.some((d) => d.toLowerCase() === lower)) return state;
      return { ...state, customDepartments: [...existing, name] };
    case 'REMOVE_CUSTOM_DEPARTMENT':
      const toRemove = action.payload;
      return {
        ...state,
        customDepartments: (state.customDepartments || []).filter((d) => d !== toRemove),
      };
    case 'SET_STEP_COUNT':
      return { ...state, stepCount: action.payload };
    case 'SET_EDITING_REPORT_ID':
      return { ...state, editingReportId: action.payload };
    case 'SET_EDITING_REDESIGN':
      return { ...state, editingRedesign: action.payload };
    case 'SET_PENDING_PATH':
      return { ...state, pendingPath: action.payload };
    case 'SET_TEAM_MODE':
      return { ...state, teamMode: action.payload };
    case 'SET_EDITING_PROCESS_INDEX':
      return { ...state, editingProcessIndex: action.payload };
    case 'RESET_PROCESS':
      return { ...state, processData: createEmptyProcess() };
    case 'SET_AUTH_USER':
      return { ...state, authUser: action.payload };
    case 'SET_CONTACT':
      return { ...state, contact: action.payload };
    case 'SET_CHAT_MESSAGES':
      return { ...state, chatMessages: action.payload };
    case 'ADD_CHAT_MESSAGE':
      return { ...state, chatMessages: [...(state.chatMessages || []), action.payload] };
    case 'TOGGLE_CHAT_OPEN':
      return { ...state, chatOpen: !state.chatOpen };
    case 'SET_CHAT_OPEN':
      return { ...state, chatOpen: !!action.payload };
    case 'ADD_AUDIT_EVENT':
      return { ...state, auditTrail: [...(state.auditTrail || []), action.payload] };
    case 'SET_AUDIT_TRAIL':
      return { ...state, auditTrail: action.payload };
    case 'RESTORE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

// --- Initial state ---
const initialState = {
  currentScreen: 0,
  maxVisitedScreen: 0,
  processData: createEmptyProcess(),
  completedProcesses: [],
  customDepartments: [],
  stepCount: 0,
  editingReportId: null,
  editingRedesign: false,
  aiRedesignMode: false,
  editingProcessIndex: null,
  diagnosticMode: 'comprehensive',
  pendingPath: 'individual',
  teamMode: false,
  authUser: null,
  contact: null,
  chatMessages: [
    { role: 'assistant', content: "Hi! I'm your process mapping assistant. Describe your workflow and I'll help build the steps, or ask me anything about process audits." },
  ],
  chatOpen: false,
  auditTrail: [],
};

// --- Context ---
const DiagnosticContext = createContext(null);

export function useDiagnostic() {
  const ctx = useContext(DiagnosticContext);
  if (!ctx) throw new Error('useDiagnostic must be used within DiagnosticProvider');
  return ctx;
}

export function DiagnosticProvider({ children }) {
  const [state, dispatch] = useReducer(diagnosticReducer, initialState);
  const saveTimeoutRef = useRef(null);
  const mountedRef = useRef(false);

  // Persist to localStorage
  const saveProgress = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const chatPersist = sanitizeChatMessagesForPersist(state.chatMessages);
      const payload = {
        currentScreen: state.currentScreen,
        processData: state.processData,
        completedProcesses: state.completedProcesses,
        customDepartments: state.customDepartments || [],
        stepCount: state.stepCount ?? 0,
        editingReportId: state.editingReportId || null,
        diagnosticMode: state.diagnosticMode || 'comprehensive',
        teamMode: state.teamMode && state.teamMode.code ? { code: state.teamMode.code } : null,
        authUser: state.authUser || null,
        contact: state.contact || null,
        auditTrail: (state.auditTrail || []).slice(-50),
        ...(chatPersist?.length ? { chatMessages: chatPersist } : {}),
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage full or unavailable
    }
  }, [
    state.currentScreen,
    state.processData,
    state.completedProcesses,
    state.customDepartments,
    state.stepCount,
    state.editingReportId,
    state.diagnosticMode,
    state.teamMode,
    state.authUser,
    state.contact,
    state.auditTrail,
    state.chatMessages,
  ]);

  // Save on state change (debounced)
  useEffect(() => {
    if (!mountedRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(saveProgress, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [saveProgress, state.currentScreen, state.processData, state.completedProcesses]);

  // Auto-save every 30s
  useEffect(() => {
    const id = setInterval(saveProgress, 30000);
    return () => clearInterval(id);
  }, [saveProgress]);

  const goToScreen = useCallback(
    (screenNum) => {
      dispatch({ type: 'SET_CURRENT_SCREEN', payload: screenNum });
    },
    []
  );

  const updateProcessData = useCallback((partial) => {
    dispatch({ type: 'UPDATE_PROCESS_DATA', payload: partial });
  }, []);

  const setProcessData = useCallback((data) => {
    dispatch({ type: 'SET_PROCESS_DATA', payload: ensureProcessDataShape(data) || createEmptyProcess() });
  }, []);

  const addCompletedProcess = useCallback((process) => {
    dispatch({ type: 'ADD_COMPLETED_PROCESS', payload: process });
  }, []);

  const replaceCompletedProcess = useCallback((index, process) => {
    dispatch({ type: 'REPLACE_COMPLETED_PROCESS', payload: { index, process } });
  }, []);

  const setCompletedProcesses = useCallback((arr) => {
    dispatch({ type: 'SET_COMPLETED_PROCESSES', payload: arr || [] });
  }, []);

  const setDiagnosticMode = useCallback((mode) => {
    dispatch({ type: 'SET_DIAGNOSTIC_MODE', payload: mode });
  }, []);

  const addCustomDepartment = useCallback((name) => {
    dispatch({ type: 'ADD_CUSTOM_DEPARTMENT', payload: name });
  }, []);

  const removeCustomDepartment = useCallback((name) => {
    dispatch({ type: 'REMOVE_CUSTOM_DEPARTMENT', payload: name });
  }, []);

  const setCustomDepartments = useCallback((arr) => {
    dispatch({ type: 'SET_CUSTOM_DEPARTMENTS', payload: arr || [] });
  }, []);

  const resetProcess = useCallback(() => {
    dispatch({ type: 'RESET_PROCESS' });
  }, []);

  const setStepCount = useCallback((n) => {
    dispatch({ type: 'SET_STEP_COUNT', payload: n });
  }, []);

  const setEditingReportId = useCallback((id) => {
    dispatch({ type: 'SET_EDITING_REPORT_ID', payload: id });
  }, []);

  const setEditingRedesign = useCallback((v) => {
    dispatch({ type: 'SET_EDITING_REDESIGN', payload: !!v });
  }, []);

  const setEditingProcessIndex = useCallback((idx) => {
    dispatch({ type: 'SET_EDITING_PROCESS_INDEX', payload: idx });
  }, []);

  const setPendingPath = useCallback((path) => {
    dispatch({ type: 'SET_PENDING_PATH', payload: path });
  }, []);

  const setTeamMode = useCallback((v) => {
    const payload = v && typeof v === 'object' && v.code ? v : (v ? { code: '' } : false);
    dispatch({ type: 'SET_TEAM_MODE', payload });
  }, []);

  const setAuthUser = useCallback((u) => {
    dispatch({ type: 'SET_AUTH_USER', payload: u });
  }, []);

  const setContact = useCallback((c) => {
    dispatch({ type: 'SET_CONTACT', payload: c });
  }, []);

  const addChatMessage = useCallback((msg) => {
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: msg });
  }, []);

  const setChatMessages = useCallback((msgs) => {
    dispatch({ type: 'SET_CHAT_MESSAGES', payload: msgs });
  }, []);

  const toggleChatOpen = useCallback(() => {
    dispatch({ type: 'TOGGLE_CHAT_OPEN' });
  }, []);

  const setChatOpen = useCallback((open) => {
    dispatch({ type: 'SET_CHAT_OPEN', payload: open });
  }, []);

  const addAuditEvent = useCallback((event) => {
    if (!state.authUser && !state.contact?.email) return;
    dispatch({ type: 'ADD_AUDIT_EVENT', payload: { ...event, timestamp: event.timestamp || new Date().toISOString(), id: Math.random().toString(36).slice(2, 10) } });
  }, [state.authUser, state.contact?.email]);

  const loadProgress = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      const data = JSON.parse(saved);
      const age = (new Date() - new Date(data.timestamp || 0)) / (1000 * 60 * 60);
      if (age >= MAX_AGE_HOURS) return null;
      const screen = data.currentScreen ?? 0;
      const hasTeam = data.teamMode && data.teamMode.code;
      if (screen <= 0 && !hasTeam) return null;
      return data;
    } catch (e) {
      return null;
    }
  }, []);

  const restoreProgress = useCallback((data) => {
    if (!data) return;
    const trail = data.auditTrail || [];
    const hasIdentity = data.authUser || data.contact?.email;
    if (hasIdentity) {
      trail.push({ id: Math.random().toString(36).slice(2, 10), type: 'resume', timestamp: new Date().toISOString(), detail: `Resumed at screen ${data.currentScreen ?? 0}` });
    }
    const restoredChat = sanitizeChatMessagesForPersist(data.chatMessages);
    dispatch({
      type: 'RESTORE',
      payload: {
        currentScreen: data.currentScreen ?? 0,
        processData: ensureProcessDataShape(data.processData) || createEmptyProcess(),
        completedProcesses: data.completedProcesses || [],
        customDepartments: data.customDepartments || [],
        stepCount: data.stepCount ?? 0,
        editingReportId: data.editingReportId || null,
        editingRedesign: !!data.editingRedesign,
        diagnosticMode: data.diagnosticMode || 'comprehensive',
        teamMode: data.teamMode || false,
        authUser: data.authUser || null,
        contact: data.contact || null,
        auditTrail: trail,
        ...(restoredChat?.length ? { chatMessages: restoredChat } : {}),
      },
    });
  }, []);

  /** POST to /api/progress - save progress to cloud, get resume link. Options: step, processDataOverride, isHandover, senderName, comments. */
  const saveProgressToCloud = useCallback(async (email = null, { step, processDataOverride, isHandover, senderName, comments } = {}) => {
    const pd = processDataOverride || state.processData;
    const chatPersist = sanitizeChatMessagesForPersist(state.chatMessages);
    const progressData = {
      currentScreen: state.currentScreen,
      processData: pd,
      completedProcesses: state.completedProcesses,
      customDepartments: state.customDepartments || [],
      stepCount: state.stepCount ?? 0,
      diagnosticMode: state.diagnosticMode || 'comprehensive',
      teamMode: state.teamMode && state.teamMode.code ? { code: state.teamMode.code } : undefined,
      contact: state.contact || null,
      authUser: state.authUser || null,
      auditTrail: (state.auditTrail || []).slice(-50),
      ...(chatPersist?.length ? { chatMessages: chatPersist } : {}),
    };
    const emailTrimmed = typeof email === 'string' ? email.trim() : '';
    const body = {
      progressData,
      currentScreen: state.currentScreen,
      processName: pd?.processName || '',
      ...(emailTrimmed ? { email: emailTrimmed } : {}),
    };
    if (step != null) body.step = step;
    if (isHandover != null) body.isHandover = isHandover;
    if (senderName) body.senderName = senderName;
    if (comments) body.comments = comments;
    const resp = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data;
    try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
    if (!resp.ok || !data.success) throw new Error(data.error || 'Save failed');
    if (state.authUser || state.contact?.email) {
      const evtType = senderName ? 'handover' : 'save';
      dispatch({ type: 'ADD_AUDIT_EVENT', payload: { id: Math.random().toString(36).slice(2, 10), type: evtType, timestamp: new Date().toISOString(), detail: evtType === 'handover' ? `Handed over by ${senderName}` : `Progress saved (screen ${state.currentScreen})` } });
    }
    return {
      resumeUrl: data.resumeUrl,
      progressId: data.progressId,
      emailSent: !!data.emailSent,
      message: data.message || '',
    };
  }, [state.currentScreen, state.processData, state.completedProcesses, state.customDepartments, state.stepCount, state.diagnosticMode, state.teamMode, state.chatMessages, state.authUser, state.contact, state.auditTrail]);

  /** POST to /api/send-diagnostic-report. Payload: { contact, summary, recommendations, automationScore, roadmap, processes, rawProcesses, customDepartments, editingReportId, timestamp } */
  const sendDiagnosticReport = useCallback(async (payload, options = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (options.accessToken) headers['Authorization'] = `Bearer ${options.accessToken}`;
    const resp = await fetch('/api/send-diagnostic-report', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        customDepartments: payload.customDepartments ?? state.customDepartments ?? [],
        editingReportId: payload.editingReportId ?? state.editingReportId,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      }),
      credentials: 'include',
    });
    let data;
    try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
    if (!resp.ok) throw new Error(data.error || 'Failed to send report');
    if (state.authUser || state.contact?.email) {
      dispatch({ type: 'ADD_AUDIT_EVENT', payload: { id: Math.random().toString(36).slice(2, 10), type: 'submit', timestamp: new Date().toISOString(), detail: state.editingReportId ? 'Report updated' : 'Process audit submitted' } });
    }
    return data;
  }, [state.customDepartments, state.editingReportId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const value = {
    ...state,
    // Actions
    goToScreen,
    updateProcessData,
    setProcessData,
    addCompletedProcess,
    replaceCompletedProcess,
    setCompletedProcesses,
    setDiagnosticMode,
    addCustomDepartment,
    removeCustomDepartment,
    setCustomDepartments,
    resetProcess,
    saveProgress,
    loadProgress,
    restoreProgress,
    saveProgressToCloud,
    sendDiagnosticReport,
    setStepCount,
    setEditingReportId,
    setEditingRedesign,
    setEditingProcessIndex,
    setPendingPath,
    setTeamMode,
    setAuthUser,
    setContact,
    addChatMessage,
    setChatMessages,
    toggleChatOpen,
    setChatOpen,
    addAuditEvent,
    // Constants (for convenience)
    TOTAL_SCREENS,
    MAP_ONLY_SCREENS,
    MAP_ONLY_STEP_LABELS,
    COMPREHENSIVE_SCREENS,
    COMPREHENSIVE_STEP_LABELS,
    SCREEN_LABELS,
    SCREEN_PHASES,
  };

  return (
    <DiagnosticContext.Provider value={value}>
      {children}
    </DiagnosticContext.Provider>
  );
}

export { TOTAL_SCREENS, MAP_ONLY_SCREENS, MAP_ONLY_STEP_LABELS, COMPREHENSIVE_SCREENS, COMPREHENSIVE_STEP_LABELS, SCREEN_LABELS, SCREEN_PHASES };
