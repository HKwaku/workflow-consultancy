/**
 * LangChain tools for the AI Recommendations Agent.
 * Uses tool() from @langchain/core/tools with zod schemas.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getIndustryKnowledge, normalizeIndustry } from './industry-knowledge.js';
import { getMethodologyGuidance } from './methodology-knowledge.js';

/* ── Tool 1: get_industry_guidance ───────────────────────────────── */

export const getIndustryGuidanceTool = tool(
  async ({ industry, processPatterns }) => {
    const normalised = normalizeIndustry(industry);
    const knowledge = getIndustryKnowledge(normalised);

    const benchmarks = knowledge.benchmarks;
    const cycleB = benchmarks.typicalProcessCycleDays;

    const output = [
      `INDUSTRY: ${knowledge.industry} (matched from: "${industry}")`,
      `SOURCE: ${knowledge.industryBenchmarkSource}`,
      '',
      '## BENCHMARKS',
      `- Typical process cycle time: ${cycleB.best}-day best / ${cycleB.median}-day median / ${cycleB.worst}-day worst`,
      `- Optimal max handoffs per process: ${benchmarks.optimalHandoffsPerProcess}`,
      `- Industry automation maturity: ${benchmarks.automationMaturity}`,
      `- Typical rework rate: ${benchmarks.avgReworkRate}`,
      '',
      '## COMMON WASTE PATTERNS IN THIS INDUSTRY',
      ...knowledge.commonWastePatterns.map((p, i) => `${i + 1}. ${p}`),
      '',
      '## HIGH-ROI AUTOMATION OPPORTUNITIES',
      ...knowledge.automationOpportunities.map((o, i) => `${i + 1}. ${o}`),
      '',
      '## REGULATORY CONTEXT',
      knowledge.regulatoryContext,
      '',
      '## RECOMMENDED FRAMEWORKS',
      knowledge.recommendedFrameworks.join(', '),
      '',
      '## KEY PROCESS RISKS',
      ...knowledge.keyRisks.map((r, i) => `${i + 1}. ${r}`),
      '',
      '## OBSERVED PATTERNS PROVIDED',
      processPatterns && processPatterns.length > 0
        ? processPatterns.join(', ')
        : 'none specified',
    ].join('\n');

    return output;
  },
  {
    name: 'get_industry_guidance',
    description:
      'Get industry-specific benchmarks, best practices, and common waste patterns for the detected industry. Call this FIRST before making recommendations.',
    schema: z.object({
      industry: z
        .string()
        .describe(
          'The industry of the organisation (e.g. "Financial Services", "Healthcare", "Manufacturing"). Use "Professional Services" if unclear.'
        ),
      processPatterns: z
        .array(z.string())
        .optional()
        .default([])
        .describe(
          'Main process patterns observed in the data (e.g. ["high-waiting-time", "poor-handoffs"])'
        ),
    }),
  }
);

/* ── Tool 2: get_methodology_guidance ────────────────────────────── */

export const getMethodologyGuidanceTool = tool(
  async ({ patterns, industry }) => {
    const guidance = getMethodologyGuidance(patterns);

    const frameworkLines = guidance.applicableFrameworks.map((f, i) =>
      [
        `### Framework ${i + 1}: ${f.framework}`,
        `Principle: ${f.principle}`,
        `Guidance: ${f.guidance}`,
        `Source: ${f.source}`,
      ].join('\n')
    );

    const output = [
      `METHODOLOGY GUIDANCE FOR INDUSTRY: ${industry || 'not specified'}`,
      `PATTERNS ANALYSED: ${patterns.join(', ')}`,
      '',
      `## PROCESS MATURITY LEVEL: ${guidance.maturityLevel.toUpperCase()}`,
      '',
      '## LEAN WASTES PRESENT',
      guidance.leanWastes.length > 0
        ? guidance.leanWastes.map(w => `- ${w}`).join('\n')
        : '- None identified from provided patterns',
      '',
      '## FRAMEWORK-SPECIFIC GUIDANCE',
      ...frameworkLines,
      '',
      '## PRIORITY ACTIONS (framework-aligned)',
      ...guidance.priorityActions.map((a, i) => `${i + 1}. ${a}`),
    ].join('\n');

    return output;
  },
  {
    name: 'get_methodology_guidance',
    description:
      'Get methodology-based guidance (PRINCE2, Lean, Gartner, Six Sigma, ISO 9001) for observed process patterns. Call AFTER get_industry_guidance.',
    schema: z.object({
      patterns: z
        .array(
          z.enum([
            'high-waiting-time',
            'poor-handoffs',
            'knowledge-concentration',
            'too-many-approvals',
            'no-process-owner',
            'manual-data-entry',
            'cross-department-delays',
            'rework-loops',
            'bottleneck-at-approval',
            'long-cycle-time',
            'no-process-metrics',
            'manual-repetitive-tasks',
            'process-variant-proliferation',
            'no-documented-procedures',
            'no-quality-objectives',
            'customer-feedback-missing',
            'no-stage-gates',
            'no-risk-register',
            'no-quality-checks',
          ])
        )
        .describe(
          'Array of process patterns detected from the diagnostic data. Choose from the enum values that best match what you observe.'
        ),
      industry: z
        .string()
        .optional()
        .describe('Industry context (informational only, does not affect output)'),
    }),
  }
);

/* ── Tool 3: record_recommendation ──────────────────────────────── */

export const recordRecommendationTool = tool(
  async (input) => {
    return JSON.stringify({ recorded: true, ...input });
  },
  {
    name: 'record_recommendation',
    description:
      'Record a single process improvement recommendation. Call this 5-8 times for your top recommendations after calling the guidance tools. Rank by impact-to-effort ratio — quick wins before projects.',
    schema: z.object({
      process: z
        .string()
        .describe(
          'Process name this recommendation applies to. Use "Cross-process" if it applies to all processes.'
        ),
      type: z
        .enum([
          'general',
          'handoff',
          'integration',
          'knowledge',
          'automation',
          'approval',
          'governance',
          'compliance',
        ])
        .describe(
          'Category: handoff=handoff problems, integration=systems not connected, knowledge=key-person risk, automation=mechanical tasks to automate, approval=approval bottlenecks, governance=missing ownership/SLAs, compliance=regulatory gaps, general=other'
        ),
      severity: z
        .enum(['high', 'medium', 'low'])
        .describe(
          'Impact severity: high=blocking delivery or significant cost/risk, medium=recurring friction, low=nice-to-have'
        ),
      finding: z
        .string()
        .max(400)
        .describe(
          'Specific observation with data reference. BAD: "handoffs are slow". GOOD: "Handoff from Sales to Operations via email (H2) requires multiple clarifications 3 of 5 times, adding 2-3 days to onboarding cycle".'
        ),
      action: z
        .string()
        .max(500)
        .describe(
          'Concrete actionable step. BAD: "improve handoffs". GOOD: "Create a structured handoff checklist for Sales-to-Operations transition: define the 5 data points required before handoff triggers, implement a shared Slack channel with a notification template, and set a 4h SLA for Operations acknowledgement."'
        ),
      estimatedTimeSavedMinutes: z
        .number()
        .int()
        .min(0)
        .max(10000)
        .describe(
          'Realistic estimate of time saved per process instance in minutes. Base on specific data from the diagnostic (step durations, waiting times, frequency). Do not fabricate large numbers.'
        ),
      effortLevel: z
        .enum(['quick-win', 'medium', 'project'])
        .describe(
          'quick-win=<1 week with no budget, medium=1-4 weeks or minor budget, project=1+ months or significant investment'
        ),
      text: z
        .string()
        .max(200)
        .describe(
          'One-sentence summary of the recommendation, leading with the impact. Example: "Automate Sales-to-Operations handoff notification, eliminating 2-3 day email delay on every onboarding."'
        ),
      industryContext: z
        .string()
        .max(500)
        .describe(
          'Industry benchmark or standard this recommendation is grounded in. Example: "APQC benchmark: median onboarding cycle for Professional Services is 10 days; current process is 23 days — 2.3× the benchmark."'
        ),
      frameworkRef: z
        .string()
        .max(300)
        .describe(
          'Specific framework principle this recommendation applies. Example: "Lean: Eliminate Waiting Waste — waiting time (14 days) exceeds active work time (3 days)" or "PRINCE2: Defined Roles & Responsibilities — no process owner assigned"'
        ),
      benchmarkSource: z
        .string()
        .max(200)
        .describe(
          'Source of the benchmark or standard cited. Example: "APQC PCF Professional Services 2024" or "Gartner BPM Research 2024" or "ISO 9001:2015 Clause 5.3"'
        ),
      exitReadiness: z
        .enum(['exit-ready', 'needs-attention', 'blocker'])
        .optional()
        .describe(
          'PE exit readiness classification — REQUIRED when the engagement context is Private Equity. exit-ready = this process is already investor/QofE ready with no action needed; needs-attention = can be resolved before exit with moderate effort; blocker = will flag in data room if unresolved, reduces deal value.'
        ),
    }),
  }
);

/* ── Export all tools ────────────────────────────────────────────── */

export const ALL_RECOMMENDATION_TOOLS = [
  getIndustryGuidanceTool,
  getMethodologyGuidanceTool,
  recordRecommendationTool,
];
