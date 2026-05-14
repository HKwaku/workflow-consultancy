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
    // Preserve chips so the four-pillar intro / artefact-opened greeting
    // / deal-aware opener don't lose their action buttons after a save
    // round-trip. Without this, restoreChatFromLocal reads a stripped
    // copy and chips visibly disappear right after first paint.
    if (Array.isArray(m.chips) && m.chips.length) {
      item.chips = m.chips
        .filter((c) => c && typeof c.name === 'string')
        .slice(0, 12)
        .map((c) => {
          const out = { name: c.name };
          if (typeof c.tagline === 'string' && c.tagline) out.tagline = c.tagline;
          if (typeof c.segmentId === 'string' && c.segmentId) out.segmentId = c.segmentId;
          return out;
        });
      if (!item.chips.length) delete item.chips;
    }
    if (m.reportActions && m.reportActions.id) {
      item.reportActions = { id: m.reportActions.id, processName: m.reportActions.processName || '' };
    }
    if (m.dealSetup && typeof m.dealSetup === 'object') {
      // The PE / M&A in-chat deal-setup form needs its props (the
      // platform/acquirer name + which kind it is) to survive a refresh.
      item.dealSetup = {
        platformCompany: typeof m.dealSetup.platformCompany === 'string' ? m.dealSetup.platformCompany : '',
        dealKind: m.dealSetup.dealKind === 'ma' ? 'ma' : 'pe',
      };
    }
    if (m.artefact && m.artefact.kind) {
      item.artefact = {
        kind: m.artefact.kind,
        refId: m.artefact.refId || null,
        label: m.artefact.label || null,
        // Snapshots can be large - keep them for the 80-message window; they're
        // already capped by MAX_CHAT_MESSAGES_PERSIST so overall payload stays bounded.
        snapshot: m.artefact.snapshot ?? null,
      };
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
    // Living-workspace rename: completedProcesses → additionalProcesses.
    // "Completed" implied a one-shot pipeline ("you finished mapping
    // process 1, now do process 2, then we'll bundle for the report").
    // In a workspace every process is live and editable; the array
    // just holds the other processes mapped in the same canvas.
    case 'SET_COMPLETED_PROCESSES':
      return { ...state, additionalProcesses: action.payload };
    case 'ADD_COMPLETED_PROCESS':
      return {
        ...state,
        additionalProcesses: [...(state.additionalProcesses || []), action.payload],
      };
    case 'REPLACE_COMPLETED_PROCESS':
      const idx = action.payload.index;
      const arr = [...(state.additionalProcesses || [])];
      if (idx >= 0 && idx < arr.length) arr[idx] = action.payload.process;
      return { ...state, additionalProcesses: arr };
    case 'SET_MODULE_ID':
      return { ...state, moduleId: action.payload };
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
    case 'SET_FOCUSED_PROCESS_ID':
      // Living-workspace contract: there is one focused process id.
      // editingReportId / viewOnlyProcessId / editingAnalysisId /
      // editingSurface are all gone as separate modes. The canvas
      // always renders the focused process; edits attempt against it;
      // RBAC is server-side. Old setters route here for back-compat.
      return { ...state, focusedProcessId: action.payload || null };
    case 'SET_EDITING_REPORT_ID':
      // Legacy alias — folded into focusedProcessId.
      return { ...state, focusedProcessId: action.payload || null };
    case 'SET_VIEW_ONLY_PROCESS_ID':
      // Legacy alias — folded into focusedProcessId. No "view-only"
      // mode in the workspace; opening a process is just focusing it.
      return { ...state, focusedProcessId: action.payload || null };
    case 'SET_EDITING_SURFACE':
      // No-op since target_data is gone post-migration.
      return state;
    case 'SET_WORKSPACE_ANCHORS':
      // payload: { operatingModelId?, functionId?, functionPath?, operatingModelName? }
      return {
        ...state,
        ...(Object.prototype.hasOwnProperty.call(action.payload || {}, 'operatingModelId')   && { selectedOperatingModelId:   action.payload.operatingModelId   || null }),
        ...(Object.prototype.hasOwnProperty.call(action.payload || {}, 'functionId')       && { selectedFunctionId:       action.payload.functionId       || null }),
        ...(Object.prototype.hasOwnProperty.call(action.payload || {}, 'functionPath')     && { selectedFunctionPath:     action.payload.functionPath     || null }),
        ...(Object.prototype.hasOwnProperty.call(action.payload || {}, 'operatingModelName') && { selectedOperatingModelName: action.payload.operatingModelName || null }),
      };
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
    case 'SET_DEAL':
      return {
        ...state,
        dealId: action.payload.dealId || null,
        dealCode: action.payload.dealCode || null,
        dealRole: action.payload.dealRole || null,
        dealName: action.payload.dealName || null,
        dealParticipants: action.payload.dealParticipants || [],
        dealCanonicalProcessName: action.payload.canonicalProcessName || null,
        dealCanonicalStart: action.payload.canonicalStart || null,
        dealCanonicalEnd: action.payload.canonicalEnd || null,
      };
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
  additionalProcesses: [],
  customDepartments: [],
  stepCount: 0,
  // Living-workspace contract: one canonical id for the focused process.
  // Anywhere that used to read editingReportId / viewOnlyProcessId can
  // read focusedProcessId; the back-compat getters in the value object
  // alias them so existing readers don't break.
  focusedProcessId: null,
  // Workspace anchors picked at the intake gate (Phase 5). Threaded into
  // /api/send-diagnostic-report so newly-mapped processes file under the
  // chosen capability instead of landing in the Unfiled bucket. The path
  // + model name are also threaded into the chat system prompt so Reina
  // knows the framing ("you're mapping a Finance / AR / Cash collection
  // process within Acme operating model").
  selectedOperatingModelId: null,
  selectedFunctionId: null,
  selectedFunctionPath: null,
  selectedOperatingModelName: null,
  // Legacy mode flags — kept as constants for back-compat readers but
  // never flip. Redesigns / deal_analyses / aiRedesign / target_data
  // are gone post-migration; there are no separate modes anymore.
  editingProcessIndex: null,
  moduleId: null,
  pendingPath: 'individual',
  teamMode: false,
  authUser: null,
  contact: null,
  // Deal context (PE Roll-up and M&A multi-participant flows)
  dealId: null,
  dealCode: null,
  dealRole: null,
  dealName: null,
  dealParticipants: [],
  dealCanonicalProcessName: null,
  dealCanonicalStart: null,
  dealCanonicalEnd: null,
  chatMessages: [],
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
        additionalProcesses: state.additionalProcesses,
        customDepartments: state.customDepartments || [],
        stepCount: state.stepCount ?? 0,
        focusedProcessId: state.focusedProcessId || null,
        moduleId: state.moduleId || null,
        teamMode: state.teamMode && state.teamMode.code ? { code: state.teamMode.code } : null,
        authUser: state.authUser || null,
        contact: state.contact || null,
        dealId: state.dealId || null,
        dealCode: state.dealCode || null,
        dealRole: state.dealRole || null,
        dealName: state.dealName || null,
        dealParticipants: state.dealParticipants || [],
        dealCanonicalProcessName: state.dealCanonicalProcessName || null,
        dealCanonicalStart: state.dealCanonicalStart || null,
        dealCanonicalEnd: state.dealCanonicalEnd || null,
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
    state.additionalProcesses,
    state.customDepartments,
    state.stepCount,
    state.focusedProcessId,
    state.moduleId,
    state.teamMode,
    state.authUser,
    state.contact,
    state.dealId,
    state.dealCode,
    state.dealRole,
    state.dealName,
    state.dealParticipants,
    state.dealCanonicalProcessName,
    state.dealCanonicalStart,
    state.dealCanonicalEnd,
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
  }, [saveProgress, state.currentScreen, state.processData, state.additionalProcesses]);

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

  // Canonical setters use the new "additionalProcesses" naming. The
  // old "completedProcesses" aliases below route to the same dispatch
  // so existing call sites compile without changes.
  const addAdditionalProcess = useCallback((process) => {
    dispatch({ type: 'ADD_COMPLETED_PROCESS', payload: process });
  }, []);
  const replaceAdditionalProcess = useCallback((index, process) => {
    dispatch({ type: 'REPLACE_COMPLETED_PROCESS', payload: { index, process } });
  }, []);
  const setAdditionalProcesses = useCallback((arr) => {
    dispatch({ type: 'SET_COMPLETED_PROCESSES', payload: arr || [] });
  }, []);
  // Legacy aliases — alias to the new setters so old consumers compile.
  const addCompletedProcess = addAdditionalProcess;
  const replaceCompletedProcess = replaceAdditionalProcess;
  const setCompletedProcesses = setAdditionalProcesses;

  const setModuleId = useCallback((id) => {
    dispatch({ type: 'SET_MODULE_ID', payload: id });
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

  const setFocusedProcessId = useCallback((id) => {
    dispatch({ type: 'SET_FOCUSED_PROCESS_ID', payload: id || null });
  }, []);

  // Legacy setters — kept so the many existing call sites compile.
  // Both route to setFocusedProcessId; there is no distinction between
  // "editing" and "view-only" anymore.
  const setEditingReportId = setFocusedProcessId;
  const setViewOnlyProcessId = setFocusedProcessId;

  // No-op setter for fully-removed mode flag. Calls compile, do nothing.
  const setEditingSurface = useCallback(() => { /* no-op */ }, []);

  const setWorkspaceAnchors = useCallback((p) => {
    dispatch({ type: 'SET_WORKSPACE_ANCHORS', payload: p || {} });
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

  const setDeal = useCallback((deal) => {
    dispatch({ type: 'SET_DEAL', payload: deal || {} });
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
        // Accept either the new key or the legacy completedProcesses on
        // restore — old persisted payloads still carry the old key.
        additionalProcesses: data.additionalProcesses || data.completedProcesses || [],
        customDepartments: data.customDepartments || [],
        stepCount: data.stepCount ?? 0,
        // Accept either the new key or the legacy editingReportId on restore
        // — old persisted payloads still carry editingReportId.
        focusedProcessId: data.focusedProcessId || data.editingReportId || null,
        moduleId: data.moduleId || null,
        teamMode: data.teamMode || false,
        authUser: data.authUser || null,
        contact: data.contact || null,
        dealId: data.dealId || null,
        dealCode: data.dealCode || null,
        dealRole: data.dealRole || null,
        dealName: data.dealName || null,
        dealParticipants: data.dealParticipants || [],
        dealCanonicalProcessName: data.dealCanonicalProcessName || null,
        dealCanonicalStart: data.dealCanonicalStart || null,
        dealCanonicalEnd: data.dealCanonicalEnd || null,
        auditTrail: trail,
        ...(restoredChat?.length ? { chatMessages: restoredChat } : {}),
      },
    });
  }, []);

  /** Snapshot of full diagnostic state - shape matches `progressData` from
   *  saveProgressToCloud so `restoreProgress` can rehydrate it verbatim.
   *  Used by the chat-session autosave so resume-from-history achieves
   *  parity with the legacy Save & continue later flow (minus email). */
  const buildFullSnapshot = useCallback((processDataOverride) => {
    const pd = processDataOverride || state.processData;
    return {
      currentScreen: state.currentScreen,
      processData: pd,
      additionalProcesses: state.additionalProcesses,
      customDepartments: state.customDepartments || [],
      stepCount: state.stepCount ?? 0,
      moduleId: state.moduleId || null,
      teamMode: state.teamMode && state.teamMode.code ? { code: state.teamMode.code } : undefined,
      contact: state.contact || null,
      authUser: state.authUser || null,
      focusedProcessId: state.focusedProcessId || null,
      dealId: state.dealId || null,
      dealCode: state.dealCode || null,
      dealRole: state.dealRole || null,
      dealName: state.dealName || null,
      dealParticipants: state.dealParticipants || [],
      dealCanonicalProcessName: state.dealCanonicalProcessName || null,
      dealCanonicalStart: state.dealCanonicalStart || null,
      dealCanonicalEnd: state.dealCanonicalEnd || null,
      auditTrail: (state.auditTrail || []).slice(-50),
    };
  }, [state.currentScreen, state.processData, state.additionalProcesses, state.customDepartments, state.stepCount, state.moduleId, state.teamMode, state.contact, state.authUser, state.focusedProcessId, state.dealId, state.dealCode, state.dealRole, state.dealName, state.dealParticipants, state.dealCanonicalProcessName, state.dealCanonicalStart, state.dealCanonicalEnd, state.auditTrail]);

  // saveProgressToCloud removed: it posted to /api/progress (now 410).
  // The living-workspace save path is autosave via PUT /api/processes/[id]
  // through sendDiagnosticReport below. No separate "save partial progress"
  // surface exists any more.

  /** POST to /api/send-diagnostic-report. Payload: { contact, summary, recommendations, automationScore, roadmap, processes, rawProcesses, customDepartments, editingReportId, timestamp } */
  // Living-workspace contract: every save is an upsert to the same
  // RESTful endpoint at `PUT /api/processes/[id]`. The first save mints
  // a UUID client-side so the row id is known immediately; subsequent
  // saves PATCH the same row. The legacy `sendDiagnosticReport` name
  // is kept for back-compat with existing callers.
  const sendDiagnosticReport = useCallback(async (payload, options = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (options.accessToken) headers['Authorization'] = `Bearer ${options.accessToken}`;

    const incomingId = payload.focusedProcessId ?? payload.editingReportId ?? state.focusedProcessId;
    const processId = incomingId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

    const body = {
      ...payload,
      customDepartments: payload.customDepartments ?? state.customDepartments ?? [],
      focusedProcessId: processId,
      timestamp: payload.timestamp ?? new Date().toISOString(),
      ...(payload.operatingModelId ?? state.selectedOperatingModelId ? {
        operatingModelId: payload.operatingModelId ?? state.selectedOperatingModelId,
      } : {}),
      ...(payload.functionId ?? state.selectedFunctionId ? {
        functionId: payload.functionId ?? state.selectedFunctionId,
      } : {}),
    };

    const resp = await fetch(`/api/processes/${encodeURIComponent(processId)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
    });
    let data;
    try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
    if (!resp.ok) throw new Error(data.error || 'Failed to save process');
    if (state.authUser || state.contact?.email) {
      dispatch({ type: 'ADD_AUDIT_EVENT', payload: { id: Math.random().toString(36).slice(2, 10), type: 'save', timestamp: new Date().toISOString(), detail: 'Process saved' } });
    }
    return data;
  }, [state.customDepartments, state.focusedProcessId, state.selectedOperatingModelId, state.selectedFunctionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Back-compat getters for the legacy mode flags. Every code path that
  // used to read editingReportId / viewOnlyProcessId now gets the
  // canonical focusedProcessId; the view-only / edit-mode distinction
  // doesn't exist anymore. The redesign / analysis / surface flags are
  // permanent-false so the old UI conditionals fold to the live edit
  // branch. completedProcesses is aliased onto additionalProcesses so
  // existing consumers compile while new code uses the canonical name.
  const value = {
    ...state,
    completedProcesses: state.additionalProcesses,
    editingReportId: state.focusedProcessId,
    viewOnlyProcessId: null,
    editingSurface: 'current',
    setFocusedProcessId,
    addAdditionalProcess,
    replaceAdditionalProcess,
    setAdditionalProcesses,
    // Actions
    setModuleId,
    goToScreen,
    updateProcessData,
    setProcessData,
    addCompletedProcess,
    replaceCompletedProcess,
    setCompletedProcesses,
    addCustomDepartment,
    removeCustomDepartment,
    setCustomDepartments,
    resetProcess,
    saveProgress,
    loadProgress,
    restoreProgress,
    buildFullSnapshot,
    sendDiagnosticReport,
    setStepCount,
    setEditingReportId,
    setViewOnlyProcessId,
    setEditingSurface,
    setWorkspaceAnchors,
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
    setDeal,
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
