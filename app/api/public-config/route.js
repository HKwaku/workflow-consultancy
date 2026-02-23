import { NextResponse } from 'next/server';

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in environment variables.' },
      { status: 503 }
    );
  }

  return NextResponse.json({ supabaseUrl, supabaseAnonKey }, {
    headers: { 'Cache-Control': 'public, max-age=300' }
  });
}
