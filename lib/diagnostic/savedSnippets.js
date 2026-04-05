const KEY_PREFIX = 'vesno_snippets_';
const MAX_SNIPPETS = 30;

function getKey(userId) {
  return KEY_PREFIX + (userId || 'anon');
}

export function loadSnippets(userId) {
  try {
    const raw = localStorage.getItem(getKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSnippet(userId, step) {
  try {
    const existing = loadSnippets(userId);
    const snippet = {
      name: step.name || 'Unnamed step',
      department: step.department || '',
      systems: step.systems || [],
      workMinutes: step.workMinutes,
      waitMinutes: step.waitMinutes,
      isDecision: step.isDecision || false,
      isExternal: step.isExternal || false,
      savedAt: new Date().toISOString(),
    };
    const deduped = existing.filter((s) => s.name !== snippet.name);
    const next = [snippet, ...deduped].slice(0, MAX_SNIPPETS);
    localStorage.setItem(getKey(userId), JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export function deleteSnippet(userId, index) {
  try {
    const existing = loadSnippets(userId);
    const next = existing.filter((_, i) => i !== index);
    localStorage.setItem(getKey(userId), JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}
