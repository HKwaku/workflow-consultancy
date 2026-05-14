/**
 * /api/deals/[id]/export.csv — DISABLED.
 *
 * Living-workspace migration: no CSV snapshot exports. Filter and copy
 * the live tables in the workspace if you need a spreadsheet.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'CSV exports are gone. The workspace tables are the live source.' },
    { status: 410 },
  );
}
