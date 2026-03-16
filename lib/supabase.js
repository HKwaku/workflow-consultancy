import { createClient } from '@supabase/supabase-js';

let supabaseClient = null;
let supabaseAdmin = null;

export function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase client config missing');
  supabaseClient = createClient(url, anonKey);
  return supabaseClient;
}

export function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase admin config missing');
  supabaseAdmin = createClient(url, serviceKey);
  return supabaseAdmin;
}
