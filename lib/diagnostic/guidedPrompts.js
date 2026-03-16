/**
 * Guided prompts for the chat-based diagnostic flow.
 * Chat starts from screen 0 with path selection, then mode, then process details.
 */

import { PROCESSES } from './processData';

const PROCESS_CHIPS = PROCESSES.map(({ id, name }) => ({ id, name }));

export const INTRO_PROMPTS = [
  {
    id: 'path',
    question: "Hello, I'm Sharp! I'll help you map your process and find where time and money are leaking. What would you like to do?",
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
      { id: 'Technology', name: 'Technology' },
      { id: 'Finance', name: 'Finance' },
      { id: 'Healthcare', name: 'Healthcare' },
      { id: 'Manufacturing', name: 'Manufacturing' },
      { id: 'Retail', name: 'Retail' },
      { id: 'Professional Services', name: 'Professional Services' },
      { id: 'Government', name: 'Government' },
      { id: 'Non-profit', name: 'Non-profit' },
      { id: 'Other', name: 'Other' },
    ],
    allowCustom: true,
    extract: (text, prompt) => {
      const chip = prompt.chips?.find((c) => text.toLowerCase().includes(c.name.toLowerCase()));
      if (chip) return { industry: chip.name };
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
];

export const PROCESS_PROMPTS = COMPREHENSIVE_PROMPTS;
