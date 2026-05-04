/**
 * SharePoint / Microsoft 365 connector via the Graph API.
 *
 * OAuth: authorization-code flow against `https://login.microsoftonline.com/common`
 * (multi-tenant) using a public client app. Refresh tokens require the
 * `offline_access` scope.
 *
 * Sync model: per-binding `delta()` against a Drive's root or a sub-item.
 * Returns a stream of changed driveItems plus a `@odata.deltaLink` we
 * persist as `delta_cursor` for next time. SharePoint dedupes for us —
 * a re-saved file gets the same `id` so our (binding_id, source_external_id)
 * unique-ish lookup updates rather than duplicates.
 *
 * Scopes:
 *   - User.Read              — read the connecting user's profile (for display label)
 *   - Files.Read.All         — read all files the user has access to (honours source ACLs)
 *   - Sites.Read.All         — discover SharePoint sites the user can see
 *   - offline_access         — refresh tokens
 *
 * Env:
 *   SHAREPOINT_CLIENT_ID     — Azure AD app (client) id
 *   SHAREPOINT_CLIENT_SECRET — Azure AD app secret (only for confidential client; public client doesn't need this)
 *   NEXT_PUBLIC_APP_URL      — used to build redirect_uri
 */

// Import from the registry module directly — importing from ../index.js
// would create a circular dependency that throws at module load.
import { registerProvider } from '../registry.js';
import { logger } from '../../logger.js';

const AUTH_BASE  = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const SCOPES = ['User.Read', 'Files.Read.All', 'Sites.Read.All', 'offline_access'];

function clientId() { return process.env.SHAREPOINT_CLIENT_ID || ''; }
function clientSecret() { return process.env.SHAREPOINT_CLIENT_SECRET || ''; }
function redirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/integrations/sharepoint/oauth/callback`;
}

registerProvider({
  id: 'sharepoint',
  label: 'Microsoft 365 / SharePoint',
  scopes: SCOPES,

  buildAuthUrl({ state }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      response_type: 'code',
      redirect_uri: redirectUri(),
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state,
      prompt: 'select_account',
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  },

  async exchangeCode({ code }) {
    const body = new URLSearchParams({
      client_id: clientId(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      scope: SCOPES.join(' '),
    });
    if (clientSecret()) body.set('client_secret', clientSecret());

    const r = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Token exchange failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const data = await r.json();

    // Fetch the user profile so we can label the integration.
    let account = {};
    try {
      const me = await fetch(`${GRAPH_BASE}/me`, { headers: { Authorization: `Bearer ${data.access_token}` } });
      if (me.ok) {
        const m = await me.json();
        account = { email: m.mail || m.userPrincipalName, displayName: m.displayName, userId: m.id };
      }
    } catch (e) { logger.warn('SharePoint /me failed', { error: e.message }); }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      scope: data.scope,
      account,
    };
  },

  async refreshToken({ refreshToken }) {
    const body = new URLSearchParams({
      client_id: clientId(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES.join(' '),
    });
    if (clientSecret()) body.set('client_secret', clientSecret());
    const r = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Refresh failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    return r.json();
  },

  /**
   * List changed driveItems since the last cursor. sourceRef for SharePoint:
   *   { drive_id, item_id?, site_id? } — item_id scopes the delta to a folder
   * subtree; omit to walk the whole drive.
   *
   * Graph delta returns only file driveItems we care about (folders pass
   * through). Deletes come back with a `deleted` property; we map them
   * to op='delete'.
   */
  async listChanges({ accessToken, sourceRef, deltaCursor }) {
    const driveId = sourceRef?.drive_id;
    const itemId  = sourceRef?.item_id;
    if (!driveId) throw new Error('sharepoint.listChanges requires drive_id');

    let url;
    if (deltaCursor) {
      url = deltaCursor; // Graph returns a fully-formed nextLink/deltaLink
    } else {
      const path = itemId
        ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/delta`
        : `/drives/${encodeURIComponent(driveId)}/root/delta`;
      url = `${GRAPH_BASE}${path}`;
    }

    const items = [];
    let nextLink = url;
    let nextCursor = null;
    // Walk @odata.nextLink pages until we land on a deltaLink; cap at 50
    // pages per sync to bound memory + duration.
    for (let i = 0; i < 50 && nextLink; i++) {
      const r = await fetch(nextLink, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`Graph delta failed (${r.status}): ${txt.slice(0, 200)}`);
      }
      const page = await r.json();
      for (const di of page.value || []) {
        if (!di.id) continue;
        if (di.deleted) {
          items.push({ externalId: di.id, op: 'delete' });
          continue;
        }
        if (!di.file) continue; // skip folder items
        items.push({
          externalId: di.id,
          op: 'upsert',
          filename: di.name || 'document',
          mimeType: di.file.mimeType || null,
          byteSize: typeof di.size === 'number' ? di.size : null,
          path: di.parentReference?.path ? `${di.parentReference.path}/${di.name}` : di.name,
        });
      }
      if (page['@odata.nextLink']) {
        nextLink = page['@odata.nextLink'];
      } else {
        nextCursor = page['@odata.deltaLink'] || null;
        nextLink = null;
      }
    }

    return { items, nextCursor };
  },

  async downloadFile({ accessToken, externalId, sourceRef }) {
    const driveId = sourceRef?.drive_id;
    if (!driveId) throw new Error('sharepoint.downloadFile requires drive_id');
    const r = await fetch(
      `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(externalId)}/content`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) throw new Error(`Graph content fetch failed: ${r.status}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  },

  /**
   * Folder picker support. Two stages: list sites (top level), then
   * list drives + items inside a chosen site/drive.
   *
   * Path forms accepted:
   *   { kind: 'sites' }
   *   { kind: 'drives', site_id }
   *   { kind: 'items',  drive_id, item_id? }
   */
  async pickFolder({ accessToken, query }) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    // Helper: pull Graph's `error.message` out of the body when a call
    // fails so the picker can show the actual cause (permission name,
    // throttling, malformed param) instead of a bare "400".
    const explain = async (r, fallback) => {
      try {
        const j = await r.json();
        const msg = j?.error?.message || j?.error_description || j?.message;
        if (msg) return `${fallback} (${r.status}): ${msg}`;
      } catch {}
      return `${fallback}: ${r.status}`;
    };
    if (query?.kind === 'sites') {
      // `/sites?search=<term>` is unreliable across tenants:
      //   - `search=*` returns 400 in some tenants (search index off /
      //     not configured for app)
      //   - empty `search=` is rejected
      //   - some tenants need the app to be granted `Sites.Read.All`
      //     with admin consent before any search call works
      // Reliable substitute: combine the root site (always works with
      // Sites.Read.All) + the user's followed sites. If the caller
      // supplies a search term, hit `?search=<term>` first; on failure
      // fall back to root + followed.
      const term = (query?.search || '').trim();
      if (term) {
        const r = await fetch(`${GRAPH_BASE}/sites?search=${encodeURIComponent(term)}`, { headers });
        if (r.ok) {
          const j = await r.json();
          return (j.value || []).map((s) => ({ id: s.id, name: s.displayName || s.name, kind: 'site', webUrl: s.webUrl }));
        }
        // Search failed — fall through to root + followed instead of
        // bubbling so the picker still produces a working list.
      }
      // Run both calls in parallel; tolerate either 4xx without aborting.
      const [rootResp, followedResp] = await Promise.all([
        fetch(`${GRAPH_BASE}/sites/root`, { headers }),
        fetch(`${GRAPH_BASE}/me/followedSites`, { headers }),
      ]);
      const out = [];
      const seen = new Set();
      if (rootResp.ok) {
        const root = await rootResp.json();
        if (root?.id) {
          out.push({ id: root.id, name: root.displayName || root.name || 'Root site', kind: 'site', webUrl: root.webUrl });
          seen.add(root.id);
        }
      }
      if (followedResp.ok) {
        const followed = await followedResp.json();
        for (const s of (followed.value || [])) {
          if (!s?.id || seen.has(s.id)) continue;
          out.push({ id: s.id, name: s.displayName || s.name, kind: 'site', webUrl: s.webUrl });
          seen.add(s.id);
        }
      }
      if (out.length === 0) {
        // Neither call worked — surface whichever error was more
        // informative so the user can act (most often this is a
        // permissions / consent issue on the Entra app).
        const err = !rootResp.ok ? await explain(rootResp, 'Graph /sites/root failed')
                                 : await explain(followedResp, 'Graph /me/followedSites failed');
        throw new Error(err);
      }
      return out;
    }
    if (query?.kind === 'drives') {
      const r = await fetch(`${GRAPH_BASE}/sites/${encodeURIComponent(query.site_id)}/drives`, { headers });
      if (!r.ok) throw new Error(await explain(r, 'Graph drives failed'));
      const j = await r.json();
      return (j.value || []).map((d) => ({ id: d.id, name: d.name, kind: 'drive' }));
    }
    if (query?.kind === 'items') {
      const path = query.item_id
        ? `/drives/${encodeURIComponent(query.drive_id)}/items/${encodeURIComponent(query.item_id)}/children`
        : `/drives/${encodeURIComponent(query.drive_id)}/root/children`;
      const r = await fetch(`${GRAPH_BASE}${path}?$select=id,name,folder,file,parentReference&$top=200`, { headers });
      if (!r.ok) throw new Error(await explain(r, 'Graph children failed'));
      const j = await r.json();
      return (j.value || [])
        .filter((it) => it.folder)
        .map((it) => ({ id: it.id, name: it.name, kind: 'folder' }));
    }
    return [];
  },
});
