/**
 * Google Drive connector.
 *
 * OAuth: standard authorization-code with `access_type=offline` so we
 * get refresh tokens (Google only issues them on first consent —
 * subsequent re-OAuths return only access tokens unless
 * `prompt=consent` is forced).
 *
 * Sync model: Drive's `changes.list` API with a `startPageToken`
 * persisted as our delta_cursor. Drive returns a stream of all changes
 * across the user's drive — we filter to changes whose file lives under
 * the bound folder. This is less efficient than per-folder polling but
 * Drive's API doesn't offer a per-folder change feed.
 *
 * Scopes:
 *   - drive.readonly         — read all files the user has access to
 *   - userinfo.email         — populate display label
 */

// Import from the registry module directly — importing from ../index.js
// would create a circular dependency that throws at module load.
import { registerProvider } from '../registry.js';
import { logger } from '../../logger.js';

const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

function clientId() { return process.env.GOOGLE_DRIVE_CLIENT_ID || ''; }
function clientSecret() { return process.env.GOOGLE_DRIVE_CLIENT_SECRET || ''; }
function redirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/integrations/google_drive/oauth/callback`;
}

registerProvider({
  id: 'google_drive',
  label: 'Google Drive',
  scopes: SCOPES,

  buildAuthUrl({ state }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent', // force a refresh-token issue every connect
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code }) {
    const body = new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Token exchange failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const data = await r.json();

    let account = {};
    try {
      const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (me.ok) {
        const m = await me.json();
        account = { email: m.email, displayName: m.name, userId: m.sub };
      }
    } catch (e) { logger.warn('Google userinfo failed', { error: e.message }); }

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
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const r = await fetch(TOKEN_URL, {
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
   * sourceRef: { folder_id }
   *
   * On first sync (no deltaCursor): bootstrap by getting startPageToken
   * AND listing the folder's existing files (so the deal pulls the
   * current state, not just future changes).
   */
  async listChanges({ accessToken, sourceRef, deltaCursor }) {
    const folderId = sourceRef?.folder_id;
    if (!folderId) throw new Error('google_drive.listChanges requires folder_id');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const items = [];
    let nextCursor = deltaCursor;

    if (!deltaCursor) {
      // Bootstrap: list current contents of the folder, then capture
      // startPageToken so subsequent syncs pick up changes.
      const list = await fetchAllPages(
        `${DRIVE_API}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)&pageSize=200`,
        headers,
      );
      for (const f of list) {
        items.push({
          externalId: f.id,
          op: 'upsert',
          filename: f.name,
          mimeType: f.mimeType,
          byteSize: f.size ? Number(f.size) : null,
        });
      }
      const t = await fetch(`${DRIVE_API}/changes/startPageToken`, { headers });
      if (t.ok) {
        const tok = await t.json();
        nextCursor = tok.startPageToken;
      }
      return { items, nextCursor };
    }

    // Delta path: walk changes.list pages until pageToken returns no nextPageToken.
    let pageToken = deltaCursor;
    let lastPageToken = deltaCursor;
    for (let i = 0; i < 50 && pageToken; i++) {
      const r = await fetch(
        `${DRIVE_API}/changes?pageToken=${encodeURIComponent(pageToken)}&fields=newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,mimeType,size,parents,trashed))&pageSize=200`,
        { headers },
      );
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`Drive changes failed (${r.status}): ${txt.slice(0, 200)}`);
      }
      const page = await r.json();
      for (const ch of page.changes || []) {
        if (ch.removed || ch.file?.trashed) {
          items.push({ externalId: ch.fileId, op: 'delete' });
          continue;
        }
        const f = ch.file;
        if (!f?.id) continue;
        // Filter to changes whose file is under our bound folder.
        const parents = Array.isArray(f.parents) ? f.parents : [];
        if (!parents.includes(folderId)) continue;
        items.push({
          externalId: f.id,
          op: 'upsert',
          filename: f.name,
          mimeType: f.mimeType,
          byteSize: f.size ? Number(f.size) : null,
        });
      }
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
      } else {
        lastPageToken = page.newStartPageToken || pageToken;
        pageToken = null;
      }
    }
    return { items, nextCursor: lastPageToken };
  },

  async downloadFile({ accessToken, externalId }) {
    const r = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(externalId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) throw new Error(`Drive content fetch failed: ${r.status}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  },

  /**
   * Folder picker — query.kind='folders', optional parent_id (defaults to root).
   */
  async pickFolder({ accessToken, query }) {
    const parentId = query?.parent_id || 'root';
    const r = await fetch(
      `${DRIVE_API}/files?q=${encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)&pageSize=200`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) throw new Error(`Drive folder list failed: ${r.status}`);
    const j = await r.json();
    return (j.files || []).map((f) => ({ id: f.id, name: f.name, kind: 'folder' }));
  },
});

async function fetchAllPages(initialUrl, headers) {
  const out = [];
  let url = initialUrl;
  for (let i = 0; i < 50 && url; i++) {
    const r = await fetch(url, { headers });
    if (!r.ok) break;
    const page = await r.json();
    if (Array.isArray(page.files)) out.push(...page.files);
    url = page.nextPageToken
      ? `${initialUrl}&pageToken=${encodeURIComponent(page.nextPageToken)}`
      : null;
  }
  return out;
}
