/**
 * Connector registry — separate module so the providers can register
 * themselves without creating a circular import with `lib/connectors/index.js`.
 *
 * The previous shape had providers `import { registerProvider } from '../index.js'`
 * while index.js side-effect-imported the providers. webpack's hoisting
 * ran the provider's top-level `registerProvider(def)` BEFORE the const
 * in index.js had initialised, throwing
 *   ReferenceError: Cannot access 'r' before initialization
 * at module load — which broke every route that transitively touched
 * the registry (workspace, chat, deals listing, integrations).
 *
 * This module owns the state. index.js only re-exports the public API
 * and triggers provider registration; providers only import from here.
 */

const _registry = new Map();

export function registerProvider(def) {
  if (!def?.id) throw new Error('Provider must have an id');
  _registry.set(def.id, def);
}

export function getProvider(id) {
  return _registry.get(id) || null;
}

export function listProviders() {
  return Array.from(_registry.values()).map((p) => ({
    id: p.id, label: p.label, scopes: p.scopes,
  }));
}
