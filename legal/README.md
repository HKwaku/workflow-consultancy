# Legal templates

> ⚠️ **NOT LEGAL ADVICE.** These are starter drafts assembled from standard SaaS contract patterns and adjusted to reflect what Vesno actually does. **A qualified lawyer must review and customise before publication.** Templates this important should not ship without sign-off.
>
> Use them as a Day-1 conversation with your lawyer instead of starting from a blank page. Expect 1-2 weeks of back-and-forth before publication-ready versions exist.

## What's in here

| File | What it is | Status |
|------|------------|--------|
| [`TERMS_OF_SERVICE.md`](./TERMS_OF_SERVICE.md) | Customer-facing terms — acceptable use, IP, liability, termination | DRAFT — needs lawyer review |
| [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) | What data we collect, how we use it, GDPR/CCPA rights, sub-processors | DRAFT — needs lawyer review |
| [`DPA.md`](./DPA.md) | Data Processing Addendum — required by GDPR Art. 28 for any B2B sale | DRAFT — needs lawyer review |
| [`SUBPROCESSORS.md`](./SUBPROCESSORS.md) | Live list of third parties we share customer data with | Living document — keep current |

## What's NOT in here (yet)

- **Master Service Agreement** — bigger contract for enterprise deals. Most firms have a template; let yours produce one.
- **Acceptable Use Policy** — rules of what users can and can't do (we cover this lightly in ToS for now).
- **Cookie Policy** — embed in PRIVACY_POLICY for v1; split when you have analytics cookies.
- **Service Level Agreement** — uptime / response-time commitments. Don't promise anything you can't measure (you don't have a status page yet).

## Open questions to resolve with the lawyer

These are the things I had to make assumptions about — flag them early:

1. **Governing jurisdiction.** Templates assume England & Wales. Change to your registered office's jurisdiction.
2. **Limitation of liability cap.** Templates use "12 months of fees paid". Lawyer will adjust based on insurance and customer pushback.
3. **Data residency commitments.** Templates say "primarily US/EU"; tighten or loosen based on actual Supabase regions.
4. **Indemnification scope.** Templates have a basic mutual indemnity for IP. Enterprise deals will demand more.
5. **Termination for convenience window.** Templates say 30 days; many SaaS use 90.
6. **Sub-processor change notification window.** Templates say 30 days; GDPR requires "reasonable" — define it.
7. **Account deletion + data return SLA.** Templates align with the 30-day grace already in code; lawyer should confirm this matches your jurisdiction's strictest read of GDPR Art. 17.
8. **Children's data.** Templates state 16+. Adjust if you've decided otherwise.

## Once published

Move the final files to `app/(marketing)/legal/` so they render at:
- `/legal/terms`
- `/legal/privacy`
- `/legal/dpa`
- `/legal/subprocessors`

Link from the marketing footer. Keep these `.md` source files versioned (the public pages are derived).
