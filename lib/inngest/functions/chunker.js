/**
 * Segment-aware chunker.
 *
 * Input: segments produced by extractText (each carrying optional locator
 * metadata: page_number/slide_number/sheet_name/cell_range/section_path).
 *
 * Output: chunks of ~target tokens that preserve segment boundaries when
 * possible. We never split inside a segment unless the segment itself exceeds
 * MAX_TOKENS_PER_CHUNK; in that case we hard-split on character boundaries
 * and keep the same locator on every part.
 *
 * Token estimate: chars/4 (good enough for chunk sizing — we don't ship this
 * to a tokenizer because that'd be slow at deal scale).
 */

const TARGET_TOKENS = 600;
const MAX_TOKENS_PER_CHUNK = 900;

function tokens(s) { return Math.ceil((s || '').length / 4); }

export function chunkText(segments) {
  const out = [];
  let buffer = [];
  let bufferTokens = 0;
  let bufferLocator = null;

  const flush = () => {
    if (!buffer.length) return;
    const content = buffer.join('\n\n').trim();
    if (content) {
      out.push({
        content,
        token_count: tokens(content),
        ...(bufferLocator || {}),
      });
    }
    buffer = [];
    bufferTokens = 0;
    bufferLocator = null;
  };

  // Locator key controls whether two segments can co-mingle in one chunk.
  // Different page numbers -> separate chunks (so citations stay precise).
  const locatorKey = (s) => JSON.stringify({
    p: s.page_number ?? null,
    sl: s.slide_number ?? null,
    sh: s.sheet_name ?? null,
    cr: s.cell_range ?? null,
    sp: s.section_path ?? null,
  });

  for (const seg of segments || []) {
    const segContent = (seg.content || '').trim();
    if (!segContent) continue;
    const segTok = tokens(segContent);
    const segLocKey = locatorKey(seg);
    const bufLocKey = bufferLocator ? locatorKey({ ...bufferLocator }) : null;

    // If adding this segment would push us over MAX, or locator changed and
    // we already have something buffered, flush.
    if (
      buffer.length &&
      ((bufferTokens + segTok > MAX_TOKENS_PER_CHUNK) || (bufLocKey && segLocKey !== bufLocKey))
    ) {
      flush();
    }

    // Hard-split single segments that exceed MAX. Carry the locator on each part.
    if (segTok > MAX_TOKENS_PER_CHUNK) {
      const charsPerChunk = TARGET_TOKENS * 4;
      for (let i = 0; i < segContent.length; i += charsPerChunk) {
        const slice = segContent.slice(i, i + charsPerChunk).trim();
        if (slice) {
          out.push({
            content: slice,
            token_count: tokens(slice),
            page_number:  seg.page_number  ?? null,
            slide_number: seg.slide_number ?? null,
            sheet_name:   seg.sheet_name   ?? null,
            cell_range:   seg.cell_range   ?? null,
            section_path: seg.section_path ?? null,
          });
        }
      }
      continue;
    }

    buffer.push(segContent);
    bufferTokens += segTok;
    bufferLocator = bufferLocator || {
      page_number:  seg.page_number  ?? null,
      slide_number: seg.slide_number ?? null,
      sheet_name:   seg.sheet_name   ?? null,
      cell_range:   seg.cell_range   ?? null,
      section_path: seg.section_path ?? null,
    };

    if (bufferTokens >= TARGET_TOKENS) flush();
  }

  flush();
  return out;
}
