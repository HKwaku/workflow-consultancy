/**
 * Buffer -> { segments[], pageCount } extractor.
 *
 * Each segment carries optional locator metadata (page/slide/sheet/range/section_path)
 * so the downstream chunker can preserve the source pointer used for citations.
 *
 * The dataroom accepts every file format. This module only attempts text
 * extraction for known formats; everything else returns `{ segments: [] }`,
 * which the worker treats as a `stored`-only document (downloadable but not
 * searchable). That avoids marking image / audio / video / archive uploads
 * as `failed`.
 *
 * Dispatches by mime_type or falls back to filename extension.
 *
 * Dependencies in package.json: mammoth, officeparser, xlsx.
 */

import mammoth from 'mammoth';
import officeparser from 'officeparser';
import * as XLSX from 'xlsx';

function extOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

// MIME prefixes/extensions that we know are NOT text-extractable. Listed
// explicitly so the worker can short-circuit without buffering the file
// into a string-cast attempt that would just produce binary garbage.
const NON_EXTRACTABLE_PREFIXES = ['image/', 'audio/', 'video/', 'font/'];
const NON_EXTRACTABLE_EXTS = new Set([
  // images
  'jpg','jpeg','png','gif','webp','heic','heif','tif','tiff','bmp','svg','ico','avif',
  // audio
  'mp3','wav','m4a','aac','ogg','opus','flac','aiff',
  // video
  'mp4','mov','avi','mkv','webm','mpeg','mpg','m4v','wmv','3gp',
  // archives / binaries
  'zip','rar','7z','tar','gz','bz2','xz','iso','dmg',
  // executables / installers
  'exe','msi','dll','so','app','deb','rpm','apk',
  // CAD / design
  'dwg','dxf','psd','ai','sketch','fig',
]);

function isNonExtractable(mt, ext) {
  if (NON_EXTRACTABLE_PREFIXES.some((p) => mt.startsWith(p))) return true;
  if (NON_EXTRACTABLE_EXTS.has(ext)) return true;
  return false;
}

export async function extractTextFromBuffer(buf, { mimeType, filename } = {}) {
  const mt = (mimeType || '').toLowerCase();
  const ext = extOf(filename);

  // Short-circuit: known-binary formats land here as `stored` without trying
  // to coerce them to UTF-8 text.
  if (isNonExtractable(mt, ext)) {
    return { segments: [], pageCount: null, reason: 'non_extractable_format' };
  }

  // DOCX -> mammoth (preserves headings; we treat each paragraph as a segment).
  if (mt.includes('wordprocessingml') || ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    const paragraphs = (value || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      segments: paragraphs.map((p) => ({ content: p, section_path: null })),
      pageCount: null,
    };
  }

  // XLSX -> per-sheet, per-range chunks. Cell range = the bounding box.
  if (mt.includes('spreadsheetml') || mt.includes('ms-excel') || ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const segments = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      const range = sheet['!ref'] || '';
      // Split a large sheet into ~50-row blocks so each chunk has a tight cell range.
      const rows = csv.split('\n');
      const BLOCK = 50;
      for (let i = 0; i < rows.length; i += BLOCK) {
        const block = rows.slice(i, i + BLOCK).join('\n').trim();
        if (!block) continue;
        segments.push({
          content: block,
          sheet_name: sheetName,
          cell_range: range,
        });
      }
    }
    return { segments, pageCount: wb.SheetNames.length };
  }

  // PDF / PPTX -> officeparser. Returns plain text; we split on form-feeds for
  // page-ish granularity where the PDF preserves them.
  if (mt === 'application/pdf' || ext === 'pdf' || mt.includes('presentationml') || ext === 'pptx') {
    const text = await new Promise((resolve, reject) => {
      officeparser.parseOffice(buf, (data, err) => {
        if (err) reject(err); else resolve(String(data || ''));
      });
    });
    // Best-effort page splitting: form-feed (PDF) or "Slide N" headings (PPTX from officeparser).
    const isPpt = mt.includes('presentationml') || ext === 'pptx';
    if (isPpt) {
      const slides = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      return {
        segments: slides.map((s, i) => ({ content: s, slide_number: i + 1 })),
        pageCount: slides.length,
      };
    }
    // PDF
    const pages = text.split('\f').map((p) => p.trim()).filter(Boolean);
    if (pages.length > 1) {
      return {
        segments: pages.map((p, i) => ({ content: p, page_number: i + 1 })),
        pageCount: pages.length,
      };
    }
    if (text.trim().length === 0) {
      // Searchable PDF with zero text usually means it's scanned image-only.
      // Surface a hint so the worker can flag this for OCR (handled upstream).
      return { segments: [], pageCount: null, reason: 'pdf_no_text_layer' };
    }
    // No form-feeds - estimate ~3000 chars/page so we still get a useful pageCount
    const approxPages = Math.max(1, Math.ceil(text.length / 3000));
    return {
      segments: [{ content: text, page_number: null }],
      pageCount: approxPages,
    };
  }

  // CSV
  if (mt === 'text/csv' || ext === 'csv') {
    const text = buf.toString('utf8');
    const rows = text.split('\n').filter((r) => r.trim());
    const BLOCK = 100;
    const segments = [];
    for (let i = 0; i < rows.length; i += BLOCK) {
      segments.push({
        content: rows.slice(i, i + BLOCK).join('\n'),
        cell_range: `rows ${i + 1}-${Math.min(i + BLOCK, rows.length)}`,
      });
    }
    return { segments, pageCount: null };
  }

  // JSON / XML / YAML / source code — all UTF-8 text. Single-segment, no
  // paragraph split (whitespace is structural).
  if (mt === 'application/json' || mt === 'application/xml' || mt === 'application/yaml'
      || ['json', 'xml', 'yaml', 'yml', 'toml', 'ini'].includes(ext)) {
    const text = buf.toString('utf8');
    return { segments: text.trim() ? [{ content: text }] : [], pageCount: null };
  }

  // Anything claiming text/* — paragraph split.
  if (mt.startsWith('text/') || ['txt', 'md', 'markdown', 'rst', 'log'].includes(ext)) {
    const text = buf.toString('utf8');
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      segments: paragraphs.map((p) => ({ content: p })),
      pageCount: null,
    };
  }

  // Unknown mime + unknown extension. Don't risk turning binary noise into
  // chunks — let the worker mark it `stored`.
  return { segments: [], pageCount: null, reason: 'unknown_format' };
}
