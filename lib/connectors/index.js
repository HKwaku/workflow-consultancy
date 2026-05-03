/**
 * Public surface for connectors. Re-exports the registry helpers and
 * triggers provider registration as a side effect of the import order
 * below.
 *
 * Adapters are registered by importing their module — each one calls
 * `registerProvider(def)` at top level. Keep the list alphabetical to
 * make additions obvious.
 *
 * IMPORTANT: providers must `import { registerProvider } from '../registry.js'`
 * (NOT from this file) — otherwise the circular import causes a
 * "Cannot access 'r' before initialization" ReferenceError at module
 * load on the bundled server build.
 */

export { getProvider, listProviders, registerProvider } from './registry.js';

import './providers/googleDrive.js';
import './providers/sharepoint.js';
