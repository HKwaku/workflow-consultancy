import { createClient } from '@supabase/supabase-js';

let supabase = null;

export async function getSupabase() {
  if (supabase) return supabase;
  const resp = await fetch('/api/public-config');
  if (!resp.ok) throw new Error('Config not available');
  const { supabaseUrl, supabaseAnonKey } = await resp.json();
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  return supabase;
}
