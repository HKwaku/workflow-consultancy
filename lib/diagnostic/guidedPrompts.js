/**
 * Guided prompts for the chat-based diagnostic flow.
 * Chat starts from screen 0 with path selection, then mode, then process details.
 */

import { PROCESSES } from './processData';

const PROCESS_CHIPS = PROCESSES.map(({ id, name }) => ({ id, name }));

export const INTRO_PROMPTS = [
  {
    id: 'path',
    question: "Hello, I'm Afi! I'll help you map your process and find where time and money are leaking. What would you like to do?",
    chips: [
      { id: 'process-map', name: 'Process Map' },
      { id: 'team-alignment', name: 'Team Alignment' },
    ],
    allowCustom: false,
    extract: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('team') || lower.includes('alignment')) return { path: 'team' };
      return { path: 'individual' };
    },
    validate: () => true,
  },
];

// PROCESS_PROMPTS is the single set of prompts used for all process diagnostics.
// It matches COMPREHENSIVE_PROMPTS — the only thing that differs from the old
// "comprehensive" mode is the removal of Screen 4 (Cost & Impact).
export const MAP_ONLY_PROMPTS = [
  {
    id: 'process',
    question: 'Which process causes you the most pain?',
    chips: PROCESS_CHIPS,
    allowCustom: true,
    extract: (text) => {
      const chip = PROCESS_CHIPS.find((c) => text.toLowerCase().includes(c.name.toLowerCase()));
      if (chip) return { processType: chip.id, processName: chip.name };
      const trimmed = text.trim();
      if (trimmed.length >= 2) return { processType: 'custom', processName: trimmed };
      return null;
    },
    validate: (data) => data?.processName?.trim(),
  },
  {
    id: 'name',
    question: (data) => `What do YOU call "${data?.processName || 'this process'}"? (e.g. "New customer setup", "Quote-to-cash")`,
    extract: (text) => ({ processName: text.trim() }),
    validate: (data) => data?.processName?.trim()?.length >= 2,
  },
  {
    id: 'teamSize',
    question: "What's your team size?",
    chips: [
      { id: '1-10', name: '1-10' },
      { id: '11-50', name: '11-50' },
      { id: '51-200', name: '51-200' },
      { id: '201-500', name: '201-500' },
      { id: '500+', name: '500+' },
    ],
    allowCustom: true,
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id) || text.toLowerCase().includes(c.name));
      if (chip) return { teamSize: chip.id };
      const trimmed = text.trim();
      if (trimmed.length >= 1) return { teamSize: trimmed };
      return {};
    },
    validate: () => true,
  },
  {
    id: 'industry',
    question: 'What industry are you in?',
    chips: [
      { id: 'Technology & Software', name: 'Technology & Software' },
      { id: 'Financial Services', name: 'Financial Services' },
      { id: 'Healthcare & Life Sciences', name: 'Healthcare & Life Sciences' },
      { id: 'Manufacturing & Engineering', name: 'Manufacturing & Engineering' },
      { id: 'Retail & E-commerce', name: 'Retail & E-commerce' },
      { id: 'Professional Services', name: 'Professional Services' },
      { id: 'Government & Public Sector', name: 'Government & Public Sector' },
      { id: 'Non-profit & Charities', name: 'Non-profit & Charities' },
      { id: 'Construction & Real Estate', name: 'Construction & Real Estate' },
      { id: 'Logistics & Supply Chain', name: 'Logistics & Supply Chain' },
      { id: 'Education & Training', name: 'Education & Training' },
      { id: 'Legal & Compliance', name: 'Legal & Compliance' },
      { id: 'Hospitality & Travel', name: 'Hospitality & Travel' },
      { id: 'Energy & Utilities', name: 'Energy & Utilities' },
      { id: 'Media & Marketing', name: 'Media & Marketing' },
      { id: 'Insurance', name: 'Insurance' },
      { id: 'Pharmaceuticals & Biotech', name: 'Pharmaceuticals & Biotech' },
      { id: 'Telecommunications', name: 'Telecommunications' },
      { id: 'Other', name: 'Other' },
    ],
    allowCustom: true,
    extract: (text, prompt) => {
      const lower = text.toLowerCase().trim();
      // Exact chip match first
      const exactChip = prompt.chips?.find((c) => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower);
      if (exactChip) return { industry: exactChip.name };
      // Partial chip match
      const partialChip = prompt.chips?.find((c) =>
        lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().split(' ')[0] === lower.split(' ')[0]
      );
      if (partialChip && partialChip.id !== 'Other') return { industry: partialChip.name };
      // Free-text fallback
      const trimmed = text.trim();
      if (trimmed.length >= 2) return { industry: trimmed };
      return {};
    },
    validate: () => true,
  },
];

export const COMPREHENSIVE_PROMPTS = [
  ...MAP_ONLY_PROMPTS,
  {
    id: 'lastExample',
    question: (data) => `Think of the last time you ran "${data?.processName || 'this process'}". What was it? (e.g. "Onboarded Acme Corp")`,
    extract: (text) => ({
      lastExample: { name: text.trim(), startDate: '', endDate: '', elapsedDays: 0 },
    }),
    validate: (data) => data?.lastExample?.name?.trim(),
  },
  {
    id: 'lastExampleDates',
    question: (data) => `When did "${data?.lastExample?.name || 'that instance'}" start and finish? (e.g. "started 3 Jan, finished 18 Jan" or "took about 2 weeks")`,
    inputType: 'dates',
    extract: (text) => {
      const t = text.trim().toLowerCase();
      const dateRegex = /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(\d{2,4})?/gi;
      const matches = [...t.matchAll(dateRegex)];
      const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      if (matches.length >= 2) {
        const yr = new Date().getFullYear();
        const d1 = new Date(parseInt(matches[0][3]) || yr, MONTHS[matches[0][2].slice(0, 3).toLowerCase()], parseInt(matches[0][1]));
        const d2 = new Date(parseInt(matches[1][3]) || yr, MONTHS[matches[1][2].slice(0, 3).toLowerCase()], parseInt(matches[1][1]));
        const days = Math.max(1, Math.round(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)));
        return { lastExample: { startDate: d1.toISOString().slice(0, 10), endDate: d2.toISOString().slice(0, 10), elapsedDays: days } };
      }
      const weekMatch = t.match(/(\d+)\s*week/);
      if (weekMatch) return { lastExample: { elapsedDays: parseInt(weekMatch[1]) * 7 } };
      const dayMatch = t.match(/(\d+)\s*day/);
      if (dayMatch) return { lastExample: { elapsedDays: parseInt(dayMatch[1]) } };
      const monthMatch = t.match(/(\d+)\s*month/);
      if (monthMatch) return { lastExample: { elapsedDays: parseInt(monthMatch[1]) * 30 } };
      return { lastExample: { elapsedDays: 0 } };
    },
    validate: () => true,
  },
  {
    id: 'performance',
    question: (data) => {
      const days = data?.lastExample?.elapsedDays;
      if (days > 0) return `That took ${days} calendar days. Was that faster, typical, or slower than usual?`;
      return `Was that instance faster, typical, or slower than usual?`;
    },
    chips: [
      { id: 'much-faster', name: 'Much faster' },
      { id: 'typical', name: 'About typical' },
      { id: 'slower', name: 'Slower than usual' },
      { id: 'way-longer', name: 'Way longer' },
    ],
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id) || text.toLowerCase().includes(c.name.toLowerCase()));
      if (chip) return { performance: chip.id };
      return { performance: 'typical' };
    },
    validate: () => true,
  },
  {
    id: 'frequency',
    question: 'How often does this process run? (e.g. "daily", "5-10 per week", "monthly")',
    chips: [
      { id: 'daily', name: 'Daily' },
      { id: 'few-per-week', name: 'A few per week' },
      { id: 'weekly', name: 'Weekly' },
      { id: 'monthly', name: 'Monthly' },
    ],
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id.replace(/-/g, ' ')) || text.toLowerCase().includes(c.name.toLowerCase()));
      if (chip) return { frequency: { type: chip.id, description: chip.name } };
      return { frequency: { type: 'custom', description: text.trim() } };
    },
    validate: () => true,
  },
  {
    id: 'priority',
    question: 'How urgent is fixing this process for your team?',
    chips: [
      { id: 'critical', name: 'Critical  -  blocking us' },
      { id: 'high', name: 'High priority' },
      { id: 'medium', name: 'Medium  -  would be nice' },
      { id: 'low', name: 'Low  -  exploring' },
    ],
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id) || text.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
      if (chip) return { priority: { level: chip.id } };
      return { priority: { level: 'medium', reason: text.trim() } };
    },
    validate: () => true,
  },

  // ── Context: which engagement type ──────────────────────────────
  {
    id: 'segment',
    question: 'Which best describes your situation?',
    chips: [
      { id: 'scaling', name: 'Growing business' },
      { id: 'ma', name: 'M&A / Integration' },
      { id: 'pe', name: 'Private Equity portfolio' },
      { id: 'highstakes', name: 'High-stakes event or deadline' },
    ],
    allowCustom: false,
    extract: (text, prompt) => {
      const lower = text.toLowerCase();
      const chip = prompt.chips?.find((c) => lower.includes(c.id) || lower.includes(c.name.toLowerCase().split(' ')[0]) || lower.includes(c.name.toLowerCase()));
      return { segment: chip?.id || 'scaling' };
    },
    validate: () => true,
  },

  // ── Segment: M&A Integration ─────────────────────────────────────
  {
    id: 'ma-entity',
    shouldShow: (data) => data?.segment === 'ma',
    question: 'Are you mapping the acquiring company\'s process or the target company\'s?',
    chips: [
      { id: 'acquiring', name: 'Acquiring company' },
      { id: 'target', name: 'Target company' },
      { id: 'both', name: 'Both / integration layer' },
    ],
    allowCustom: false,
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id) || text.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
      return { maEntity: chip?.id || 'acquiring' };
    },
    validate: () => true,
  },
  {
    id: 'ma-timeline',
    shouldShow: (data) => data?.segment === 'ma',
    question: 'Where are you in the integration timeline?',
    chips: [
      { id: 'pre-close', name: 'Pre-close' },
      { id: '0-30', name: '0–30 days post-close' },
      { id: '31-90', name: '31–90 days post-close' },
      { id: '90+', name: '90+ days post-close' },
    ],
    allowCustom: false,
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id.replace(/-/g, ' ')) || text.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
      return { maTimeline: chip?.id || text.trim() };
    },
    validate: () => true,
  },

  // ── Segment: Private Equity ──────────────────────────────────────
  {
    id: 'pe-stage',
    shouldShow: (data) => data?.segment === 'pe',
    question: 'What stage of the ownership cycle are you at?',
    chips: [
      { id: 'day1', name: 'Day 1 baseline' },
      { id: 'value-creation', name: 'Value creation plan' },
      { id: 'pre-exit', name: 'Pre-exit / data room' },
    ],
    allowCustom: false,
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id.replace(/-/g, ' ')) || text.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
      return { peStage: chip?.id || 'value-creation' };
    },
    validate: () => true,
  },

  // ── Segment: High-stakes Events ──────────────────────────────────
  {
    id: 'highstakes-type',
    shouldShow: (data) => data?.segment === 'highstakes',
    question: 'Which best describes this engagement?',
    chips: [
      { id: 'carve-out', name: 'Carve-out' },
      { id: 'erp', name: 'ERP implementation' },
      { id: 'vc-backed', name: 'VC-backed scale-up' },
      { id: 'other', name: 'Other high-stakes' },
    ],
    allowCustom: true,
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.id.replace(/-/g, ' ')) || text.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
      return { highStakesType: chip?.id || text.trim() };
    },
    validate: () => true,
  },
  {
    id: 'highstakes-deadline',
    shouldShow: (data) => data?.segment === 'highstakes',
    question: 'What is your hard deadline or go-live date? (e.g. "End of Q2", "30 June")',
    extract: (text) => ({ highStakesDeadline: text.trim() }),
    validate: () => true,
  },
];

export const PROCESS_PROMPTS = COMPREHENSIVE_PROMPTS;
