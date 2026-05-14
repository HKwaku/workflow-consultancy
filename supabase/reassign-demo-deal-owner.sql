-- ============================================================
-- Diagnose + repair the demo deal owner mismatch.
--
-- 403 from /api/deals/<id> means the signed-in user's email doesn't
-- match the deal's owner_email (and they're not a collaborator or
-- participant). The seed used 'hope.tettey@gmail.com' by default; if
-- you're signed in as someone else, run the UPDATE below to reassign.
-- ============================================================

-- 1. Inspect the current owner of both demo deals.
SELECT id, deal_code, type, name, owner_email, owner_user_id
  FROM public.deals
 WHERE name IN (
   'Apex Bank acquires Lumen Digital',
   'Helix Health platform consolidation'
 );

-- 2. Reassign both demo deals to your email. Replace the literal
--    on the right with whatever address you sign in with.
UPDATE public.deals
   SET owner_email = lower('PUT_YOUR_EMAIL_HERE@example.com'),
       owner_user_id = NULL  -- forces owner_email to be the match key
 WHERE name IN (
   'Apex Bank acquires Lumen Digital',
   'Helix Health platform consolidation'
 );

-- 3. (Optional) Also reassign every diagnostic_report seeded for
--    these deals so /api/get-diagnostic edits don't 403 either.
UPDATE public.diagnostic_reports
   SET contact_email = lower('PUT_YOUR_EMAIL_HERE@example.com')
 WHERE id IN (
   SELECT df.report_id FROM public.deal_flows df
     JOIN public.deals d ON d.id = df.deal_id
    WHERE d.name IN (
      'Apex Bank acquires Lumen Digital',
      'Helix Health platform consolidation'
    )
     AND df.report_id IS NOT NULL
 );

-- 4. Verify - rows should now show your email.
SELECT id, name, owner_email FROM public.deals
 WHERE name IN (
   'Apex Bank acquires Lumen Digital',
   'Helix Health platform consolidation'
 );
