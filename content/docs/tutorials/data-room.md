---
title: The data room
group: Tutorials
order: 4
summary: How Vesno indexes any file you throw at it, OCR for scanned PDFs, AI categorisation, and the expected-docs checklist.
---

The deal **data room** is a per-deal file store that powers semantic search, evidence-cited findings, and the diligence memo. This page covers what it accepts, how it processes each format, and the affordances that turn a file dump into something you can actually use.

## What it accepts

Every format. Drag any file into the workspace modal's data-room section. The 50 MB size cap and SHA-256 deduplication are the only filters.

What happens next depends on the file type.

| Format | Status after processing | Searchable? |
|---|---|---|
| **PDF, DOCX, XLSX, PPTX** | `ready` | Yes — chunked + embedded |
| **CSV, TXT, MD, JSON, XML, source code** | `ready` | Yes |
| **Scanned PDF (no text layer)** | `ready` (if OCR configured) or `stored` | Yes after OCR |
| **Image (JPG/PNG/HEIC/SVG/…)** | `ready` (if OCR configured) or `stored` | Image text after OCR; otherwise no |
| **Audio, video, archive, executable, CAD** | `stored` | No — downloadable + previewable only |

`stored` is the new bit. Previously Vesno would reject anything outside its allow-list. Now everything lands in the data room and `stored`-only docs are clearly marked but still openable, so the diligence team's full evidence base lives in one place.

## OCR for scanned PDFs and images

Diligence dumps usually include signed contracts, photographs of board minutes, screenshots of dashboards — all of which arrive as image-only PDFs or images. Without OCR, those files would land as `stored` (downloadable but invisible to search and citations).

**Set it up** in seconds:

1. Sign up at [console.mistral.ai](https://console.mistral.ai) and grab an API key
2. Open **Org admin → API keys → Mistral (OCR)** and paste the key
3. New scanned uploads automatically run through OCR; existing `stored` docs can be re-processed (Reprocess button on the document row)

Once configured, OCR runs whenever:
- The file's MIME starts with `image/`, OR
- A PDF returns no extractable text on the first pass

Per-page text feeds the same chunker → embedder pipeline as native extraction; the document becomes first-class for search and findings.

> **Why Mistral?** Native PDF support (no rasterisation), per-page accuracy on financial / legal docs, and per-page billing that's predictable on large dumps. If you'd rather use AWS Textract, Google Document AI, or self-hosted Tesseract, the OCR adapter is a single file (`lib/ai/ocr.js`).

## AI categorisation

When a document finishes processing, a small Haiku call classifies it into one of:

- **Financial** — P&L, balance sheet, cash flow, mgmt accounts, audit reports
- **Legal** — Contracts, NDAs, articles, board minutes, litigation, regulatory
- **HR** — Employment contracts, org charts, comp & benefits, policies
- **IP** — Patents, trademarks, copyright, IP register, licences
- **Tech** — Architecture, code, security audits, infra
- **Commercial** — Sales pipeline, customers, pricing, marketing
- **Operational** — Process docs, SOPs, supplier contracts, logistics
- **Other** — anything that doesn't fit

The category appears in the doc list meta line and powers the **Expected documents** checklist (below). You can override any AI guess via the document row's edit affordance — the override sticks.

## Expected documents checklist

Diligence is always a checklist exercise. The deal team has a mental model of what *should* be in the data room and chases the seller for what's missing. Vesno codifies a starter list per deal type so the workspace can show "received vs missing" instead of you having to remember the canonical bundle.

What's expected depends on the deal type:

| Type | Examples |
|---|---|
| **M&A** | Articles, cap table, board minutes, audited accounts, mgmt accounts, forecast, tax returns, employment contracts, org chart, IP register, customer concentration, CIM, data-room index, change-of-control consents |
| **PE roll-up** | All of the above + platform company summary + add-on acquisition pipeline |
| **Scaling** | All of the above + product roadmap + system architecture + security audit / SOC report |

The checklist sits collapsed by default in the data-room section. Click to expand — each line shows ✓ / ○, matched docs are clickable, and the header counter ("3 / 12 received") gives the at-a-glance state.

A doc satisfies a checklist item if its filename or label contains the item's keywords AND its category matches one of the item's allowed buckets. So a misnamed file may not match — rename or relabel it and the checklist updates.

## Document statuses

| Status | Meaning |
|---|---|
| `pending` | Row inserted, file uploaded, worker not yet started |
| `parsing` | Worker is extracting text (or running OCR) |
| `embedding` | Text extracted, chunks inserted, embeddings being generated |
| `ready` | Chunks + embeddings written, available for search and citations |
| `stored` | File accepted but not text-indexed (image/audio/video/archive, or scanned PDF without OCR). Downloadable + previewable from the workspace. |
| `failed` | Genuine extractor error — see `processing_error` for the message and click Reprocess to retry |

## Reprocess + finding staleness

Click **Reprocess** on a document to re-run the whole pipeline. Use cases:

- A failed upload after fixing the underlying issue (e.g. `MISTRAL_API_KEY` was added)
- Re-chunking after a worker upgrade
- Replacing a v1 with v2 of a contract — re-upload it, then reprocess to get the new chunks

When a document is reprocessed, every finding citing it is **eagerly flagged STALE** in the workspace (yellow badge on the row). The finding isn't deleted — the partner needs to see what was claimed and decide whether the new chunk text still supports it. Click **Mark verified** on the in-row stale bar to clear once you've checked.

## External sources — SharePoint and Google Drive

Customers who already keep documents in SharePoint, OneDrive for Business, or Google Drive can connect their account once at the org level, then bind specific folders to each deal. Vesno polls the source for changes and pulls new files into the data room automatically.

**One-time org setup** (org admin only): **Org admin → Integrations** → click **Connect** on Microsoft 365 / SharePoint or Google Drive → sign in with the work / Google Workspace account that owns the folders → consent. Vesno stores the encrypted refresh token; raw tokens never reach the browser.

**Per-deal binding** (any deal editor): **Workspace → Data room → + Microsoft 365 / SharePoint** or **+ Google Drive** → pick a folder from the picker. The picker walks sites → drives → folders for SharePoint, or top-level folders for Drive. The binding shows up under "Synced from" with a status pill (active / syncing / error).

**What syncs:**
- Existing files in the bound folder land as documents in the data room on the first sync, going through the same parse / OCR / chunk / embed pipeline as manual uploads
- New files added to the bound folder pull in on the next sync (every ~10 minutes)
- Files removed from the source are not deleted from Vesno — Vesno snapshots evidence at chunk-creation time so findings citing them remain valid even after the source file is gone
- File renames / moves within the bound folder are tracked as updates rather than re-uploads

**SharePoint specifics:**
- The OAuth flow uses `/organizations` (work / school accounts only) — personal Microsoft accounts (outlook.com / hotmail.com) are excluded since they have no SharePoint
- If your tenant blocks user consent for unverified multi-tenant apps, your Microsoft 365 admin needs to grant org-wide consent once: `https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<vesno-app-id>` (your operator can give you these IDs). Vesno is working toward Verified Publisher status to remove this step.
- The picker falls back to OneDrive for Business if SharePoint sites aren't accessible from the connected account — useful for users without an SPO licence but with OneDrive

**Google Drive specifics:**
- Bound folder must be under "My Drive" or a Shared Drive the connecting account has at least Viewer access on
- Files in subfolders are picked up; subfolder structure is flattened in the data room view

**Disconnect:** Org admin → Integrations → **Disconnect** on the provider card. Existing synced documents stay in the deal (so findings keep their evidence); future syncs stop. Re-connect any time without losing prior history.

## Privacy + visibility

Each document carries a `visibility` setting:

- **All editors** (default) — anyone with deal access (owner / collaborator / participant) can read
- **Acquirer only / Target only / Portfolio only / Owner only** — restricts to that role

Visibility is enforced both client-side (the doc list filter) and server-side (every download, evidence drawer, and chunk preview re-checks). See [Per-party visibility](/docs/reference/per-party-visibility) for the full rules per deal type.

## Common questions

**My file uploaded but the search doesn't surface it.** Check the status. If `pending` / `parsing` / `embedding`, wait — the worker hasn't finished. If `stored`, it's not text-indexed (configure OCR for scanned PDFs, or accept it as download-only). If `failed`, check `processing_error` and click Reprocess.

**The same file gets uploaded twice.** Vesno deduplicates by SHA-256 — the second upload returns the existing row instead of creating a new one. No double-billing.

**Can I bulk-upload?** The drag-drop accepts multiple files at once. Each lands as a separate document row.

**How do I delete a document?** From the workspace, expand the row and click the delete icon. Bytes are removed from storage and the chunks cascade.
