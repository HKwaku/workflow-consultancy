/**
 * GET /api/docs/list
 *
 * Returns the docs sidebar navigation for the chat-rail Docs popover.
 * No auth required — same content the public /docs route renders.
 *
 * Response: { groups: [{ group, items: [{ slug, title }] }] }
 */

import { NextResponse } from 'next/server';
import { getNavigation } from '@/lib/docsCatalogue';

export const revalidate = 3600; // cache 1 hr

export async function GET() {
  try {
    const groups = getNavigation();
    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
