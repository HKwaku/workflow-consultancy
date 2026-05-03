/**
 * Per-deal-type "expected documents" template.
 *
 * Diligence is always a checklist exercise — the deal team has a mental list
 * of what *should* be in the data room, and chases the seller for what's
 * missing. We codify a small starter list per deal type so the workspace can
 * show "received vs missing" at a glance instead of users having to remember
 * the canonical bundle.
 *
 * Each item maps to one or more category buckets (from categorizeDoc.js) and
 * a set of filename keywords. A doc satisfies the item if it lives in any of
 * the listed categories AND its filename / label contains any of the
 * keywords (case-insensitive). Categories alone aren't precise enough — a
 * "Financial" doc could be an invoice OR a P&L; the keyword filter narrows
 * it. Keywords alone miss AI-categorised non-keyword matches; together they
 * catch most real uploads.
 */

const COMMON_ITEMS = [
  // Legal / corporate
  { id: 'articles',           label: 'Articles of association',          categories: ['Legal'],     keywords: ['articles', 'incorporation', 'memo of association', 'bylaws'] },
  { id: 'cap_table',          label: 'Cap table / share register',       categories: ['Legal', 'Financial'], keywords: ['cap table', 'capitalization', 'capitalisation', 'share register', 'shareholding'] },
  { id: 'board_minutes',      label: 'Board minutes (last 12 months)',   categories: ['Legal'],     keywords: ['board minutes', 'board meeting', 'minutes'] },
  { id: 'material_contracts', label: 'Material customer / supplier contracts', categories: ['Legal', 'Commercial'], keywords: ['contract', 'msa', 'master service', 'agreement', 'sla'] },

  // Financial
  { id: 'audited_accounts',   label: 'Audited accounts (3 years)',       categories: ['Financial'], keywords: ['audited', 'annual report', 'financial statements', 'statutory accounts'] },
  { id: 'mgmt_accounts',      label: 'Latest management accounts',       categories: ['Financial'], keywords: ['management accounts', 'mgmt accounts', 'monthly p&l', 'monthly p and l'] },
  { id: 'forecast',           label: 'Forecast / budget',                categories: ['Financial'], keywords: ['forecast', 'budget', 'plan', 'projection'] },
  { id: 'tax_returns',        label: 'Tax returns / VAT filings',        categories: ['Financial', 'Legal'], keywords: ['tax return', 'vat', 'corporation tax', 'hmrc', 'irs'] },

  // HR
  { id: 'employment_contracts', label: 'Key employee contracts',         categories: ['HR'],        keywords: ['employment contract', 'employment agreement', 'offer letter'] },
  { id: 'org_chart',          label: 'Org chart',                        categories: ['HR'],        keywords: ['org chart', 'organisation chart', 'organization chart', 'headcount'] },

  // IP
  { id: 'ip_register',        label: 'IP register (patents, trademarks)', categories: ['IP'],       keywords: ['ip register', 'patent', 'trademark', 'trade mark', 'copyright'] },

  // Commercial
  { id: 'customer_concentration', label: 'Customer concentration / pipeline', categories: ['Commercial'], keywords: ['customer concentration', 'pipeline', 'top customers', 'arr', 'mrr'] },
];

const PE_ROLLUP_EXTRAS = [
  { id: 'platform_summary',   label: 'Platform company summary',          categories: ['Commercial', 'Financial'], keywords: ['platform', 'thesis', 'investment memo', 'cim'] },
  { id: 'addon_pipeline',     label: 'Add-on acquisition pipeline',       categories: ['Commercial'], keywords: ['add-on', 'addon', 'pipeline', 'targets', 'rollup', 'roll-up'] },
];

const MA_EXTRAS = [
  { id: 'cim',                label: 'Confidential information memorandum (CIM)', categories: ['Commercial', 'Financial'], keywords: ['cim', 'information memorandum', 'teaser', 'sale memo'] },
  { id: 'data_room_index',    label: 'Seller data room index',            categories: ['Other', 'Legal'], keywords: ['data room index', 'index', 'document list'] },
  { id: 'change_control',     label: 'Customer change-of-control consents', categories: ['Legal', 'Commercial'], keywords: ['change of control', 'consent', 'assignment'] },
];

const SCALING_EXTRAS = [
  { id: 'product_roadmap',    label: 'Product roadmap',                   categories: ['Tech', 'Commercial'], keywords: ['roadmap', 'product plan'] },
  { id: 'tech_architecture',  label: 'System architecture overview',      categories: ['Tech'],      keywords: ['architecture', 'system design', 'infra', 'infrastructure'] },
  { id: 'security_audit',     label: 'Security audit / SOC report',       categories: ['Tech', 'Legal'], keywords: ['security audit', 'soc 2', 'soc2', 'penetration', 'pentest', 'iso 27001'] },
];

const TEMPLATES = {
  ma:        [...COMMON_ITEMS, ...MA_EXTRAS],
  pe_rollup: [...COMMON_ITEMS, ...PE_ROLLUP_EXTRAS],
  scaling:   [...COMMON_ITEMS, ...SCALING_EXTRAS],
};

export function getChecklistForDealType(dealType) {
  return TEMPLATES[dealType] || COMMON_ITEMS;
}

/**
 * Match each checklist item against the documents already in the data room.
 * Returns an array of { ...item, matched: doc[] } so the UI can render a
 * received / missing list and link straight to the matching docs.
 */
export function matchChecklist(documents, dealType) {
  const checklist = getChecklistForDealType(dealType);
  const docs = Array.isArray(documents) ? documents : [];
  return checklist.map((item) => {
    const kws = item.keywords.map((k) => k.toLowerCase());
    const cats = new Set(item.categories);
    const matched = docs.filter((d) => {
      const cat = d.category || '';
      const text = `${d.filename || ''} ${d.label || ''}`.toLowerCase();
      const catHit = cats.has(cat);
      const kwHit  = kws.some((k) => text.includes(k));
      // Require BOTH a keyword hit AND a category match. The previous
      // `cats.size === 0` escape hatch was a foot-gun: if a checklist
      // item ever shipped with an empty categories list (schema drift,
      // partial config), any keyword hit would satisfy it. Items without
      // category constraints should be rare; if you hit one, fix the
      // template instead of relaxing the matcher.
      return kwHit && catHit;
    });
    return { ...item, matched };
  });
}
