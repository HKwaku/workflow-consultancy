#!/usr/bin/env node
/**
 * Test script for get-dashboard API - verifies Supabase connection and data retrieval.
 * Run: node scripts/test-dashboard-api.js [email]
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in env (or use: node --env-file=.env scripts/test-dashboard-api.js)
 */
const email = process.argv[2] || 'test@example.com';

async function test() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set in .env or .env.local');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  let queryEmail = email;
  if (!process.argv[2]) {
    const { data: allRows, error: listErr } = await supabase
      .from('diagnostic_reports')
      .select('contact_email,created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    if (listErr) {
      console.error('Supabase list error:', listErr.message);
      process.exit(1);
    }
    if (allRows?.length) {
      console.log('Recent reports in DB:', allRows.length);
      console.log('Emails:', allRows.map(r => r.contact_email).join(', '));
      queryEmail = allRows[0].contact_email;
      console.log('\nQuerying with:', queryEmail, '\n');
    }
  }

  const { data, error } = await supabase
    .from('diagnostic_reports')
    .select('id,contact_email,contact_name,company,created_at')
    .ilike('contact_email', queryEmail)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }
  console.log('Query for email:', queryEmail);
  console.log('Rows found:', data?.length ?? 0);
  if (data?.length) {
    console.log('Sample:', JSON.stringify(data[0], null, 2));
  } else {
    console.log('No reports for this email.');
  }
}

test();
