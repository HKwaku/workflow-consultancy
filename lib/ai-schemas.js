/**
 * Zod schemas for validating AI-generated JSON outputs.
 */
import { z } from 'zod';

export const ProcessRecommendationSchema = z.object({
  process: z.string().optional().default('Overall'),
  type: z.enum(['general', 'handoff', 'integration', 'knowledge', 'automation', 'approval', 'governance', 'compliance']).optional().default('general'),
  severity: z.enum(['high', 'medium', 'low']).optional(),
  finding: z.string().max(1000).optional(),
  action: z.string().max(1000).optional(),
  estimatedTimeSavedMinutes: z.number().min(0).max(10000).optional(),
  effortLevel: z.enum(['quick-win', 'medium', 'project']).optional(),
  text: z.string().max(2000),
  industryContext: z.string().max(500).optional(),
  frameworkRef: z.string().max(300).optional(),
  benchmarkSource: z.string().max(200).optional(),
}).passthrough();

export const ProcessRecommendationsSchema = z.array(ProcessRecommendationSchema);

export const SurveyAnalysisSchema = z.object({
  summary: z.string().optional().default(''),
  keyFindings: z.array(z.string()).optional().default([]),
  bottlenecks: z.array(z.string()).optional().default([]),
  recommendations: z.array(z.string()).optional().default([]),
  estimatedSavings: z.union([z.string(), z.number()]).optional(),
}).passthrough();

export const TeamGapAnalysisSchema = z.object({
  executiveSummary: z.string().optional().default(''),
  rootCauses: z.array(z.string()).optional().default([]),
  hiddenInefficiencies: z.array(z.object({
    title: z.string().optional(),
    insight: z.string().optional(),
  }).passthrough()).optional().default([]),
  recommendations: z.array(z.object({
    priority: z.number().int().min(1).max(10).optional(),
    action: z.string().max(1000).optional(),
    impact: z.string().max(500).optional(),
    owner: z.string().max(200).optional(),
    timeframe: z.string().max(200).optional(),
  }).passthrough()).optional().default([]),
  alignmentActions: z.array(z.string()).optional().default([]),
}).passthrough();

export function parseWithSchema(schema, raw, fallback) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
  } catch (_) { /* ignore */ }
  return fallback;
}

// Input validation for API request bodies
const ProcessStepSchema = z.object({
  number: z.number().optional(),
  name: z.string().max(500).optional(),
  department: z.string().max(200).optional(),
  isDecision: z.boolean().optional(),
  isExternal: z.boolean().optional(),
  branches: z.array(z.any()).optional(),
  durationMinutes: z.number().optional(),
  workMinutes: z.number().optional(),
  waitMinutes: z.number().optional(),
}).passthrough();

const ProcessInputSchema = z.object({
  processName: z.string().max(200).optional(),
  processType: z.string().max(100).optional(),
  steps: z.array(ProcessStepSchema).max(200).optional(),
  handoffs: z.array(z.any()).max(100).optional(),
  definition: z.any().optional(),
  lastExample: z.any().optional(),
  costs: z.any().optional(),
  frequency: z.any().optional(),
  savings: z.any().optional(),
  bottleneck: z.any().optional(),
  priority: z.any().optional(),
}).passthrough();

export const ProcessDiagnosticInputSchema = z.object({
  processes: z.array(ProcessInputSchema).min(1).max(50),
  contact: z.object({
    name: z.string().max(200).optional(),
    email: z.union([z.string().email().max(254), z.literal('')]).optional(),
    company: z.string().max(200).optional(),
    segment: z.string().max(50).optional(),
  }).passthrough().optional(),
  qualityScore: z.union([z.number(), z.object({ averageScore: z.number().optional() }).passthrough()]).optional(),
  diagnosticMode: z.string().max(50).optional(),
  timestamp: z.string().optional(),
}).passthrough();

const SurveyWorkflowSchema = z.object({
  workflowName: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  steps: z.array(z.any()).max(500).optional(),
  handoffs: z.array(z.any()).max(200).optional(),
}).passthrough();

export const SurveySubmitInputSchema = z.object({
  workflows: z.array(SurveyWorkflowSchema).min(1).max(50),
  diagnostic: z.any().optional(),
}).passthrough();

export const SendDiagnosticReportInputSchema = z.object({
  editingReportId: z.string().uuid().nullish(),
  contact: z.object({
    email: z.string().max(254).optional(),
    name: z.string().max(200).optional(),
    company: z.string().max(200).optional(),
    segment: z.string().max(50).optional(),
  }).passthrough().optional(),
  fallbackEmail: z.string().max(254).optional(),
  authToken: z.string().optional(),
  summary: z.any().optional(),
  recommendations: z.any().optional(),
  automationScore: z.any().optional(),
  roadmap: z.any().optional(),
  processes: z.any().optional(),
  rawProcesses: z.any().optional(),
  customDepartments: z.any().optional(),
  diagnosticMode: z.string().max(50).optional(),
  timestamp: z.string().optional(),
  userId: z.string().optional(),
  progressId: z.string().uuid().optional(),
  auditTrail: z.any().optional(),
  contributorEmails: z.array(z.string().max(254)).max(20).optional(),
  costAnalystEmail: z.string().max(254).optional().nullable(),
  parentReportId: z.string().uuid().optional().nullable(),
}).passthrough();

// Progress API: progressData is required and must be an object
export const ProgressInputSchema = z.object({
  progressData: z.record(z.string(), z.unknown()),
  email: z.string().email().max(254).optional(),
  currentScreen: z.number().optional(),
  processName: z.string().max(200).optional(),
  isHandover: z.boolean().optional(),
  senderName: z.string().max(200).optional(),
  comments: z.string().max(2000).optional(),
  progressId: z.string().uuid().optional(),
  step: z.number().optional(),
}).passthrough();

// Process instances: processName max 200, instanceName max 200, notes max 1000
export const ProcessInstanceInputSchema = z.object({
  processName: z.string().min(1).max(200),
  instanceName: z.string().max(200).optional(),
  status: z.enum(['started', 'in-progress', 'waiting', 'stuck', 'completed', 'cancelled']),
  notes: z.string().max(1000).optional(),
  reportId: z.string().uuid().optional(),
  email: z.string().email().max(254).optional(),
  userId: z.string().max(200).optional(),
}).passthrough();

// Get followups POST: reportId UUID, followupType one of day3, day14, day30
export const GetFollowupsPostSchema = z.object({
  reportId: z.string().uuid(),
  followupType: z.enum(['day3', 'day14', 'day30']),
}).passthrough();

// Team create
export const TeamCreateSchema = z.object({
  processName: z.string().min(1).max(200),
  createdByEmail: z.string().email().max(254).optional(),
  createdByName: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
}).passthrough();

// Team submit response: responseData must be object, max ~500KB when stringified
export const TeamSubmitSchema = z.object({
  teamCode: z.string().min(4).max(12).regex(/^[a-zA-Z0-9]+$/),
  respondentName: z.string().min(1).max(200),
  respondentEmail: z.string().email().max(254).optional(),
  respondentDepartment: z.string().max(100).optional(),
  responseData: z.record(z.string(), z.unknown()),
}).passthrough();

// Team invite
export const TeamInviteSchema = z.object({
  teamCode: z.string().min(4).max(12).regex(/^[a-zA-Z0-9]+$/),
  invitees: z.array(z.object({ email: z.string().max(254).optional(), name: z.string().max(200).optional() })).min(1).max(50),
  inviterName: z.string().max(200).optional(),
  processName: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
}).passthrough();

// Team close
export const TeamCloseSchema = z.object({
  teamCode: z.string().min(4).max(12).regex(/^[a-zA-Z0-9]+$/),
  email: z.string().email().max(254),
}).passthrough();

// Team delete (auth from session)
export const TeamDeleteSchema = z.object({
  teamCode: z.string().min(4).max(12).regex(/^[a-zA-Z0-9]+$/),
}).passthrough();

// Update diagnostic (PUT)
export const UpdateDiagnosticSchema = z.object({
  reportId: z.string().uuid(),
  updates: z.object({
    contactName: z.string().max(200).optional(),
    contactEmail: z.string().email().max(254).optional(),
    company: z.string().max(200).optional(),
    leadScore: z.number().optional(),
    leadGrade: z.string().max(50).optional(),
    contact: z.record(z.string(), z.unknown()).optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
    automationScore: z.record(z.string(), z.unknown()).optional(),
    processes: z.array(z.any()).optional(),
    rawProcesses: z.array(z.any()).optional(),
    recommendations: z.array(z.any()).optional(),
    roadmap: z.any().optional(),
    customDepartments: z.array(z.any()).optional(),
    redesign: z.record(z.string(), z.unknown()).optional(),
  }),
}).passthrough();

// Get diagnostic PATCH (steps update)
const DiagnosticStepSchema = z.object({
  number: z.number().optional(),
  name: z.string().max(500).optional(),
  department: z.string().max(200).optional(),
  isDecision: z.boolean().optional(),
  isExternal: z.boolean().optional(),
  branches: z.array(z.any()).optional(),
}).passthrough();

export const GetDiagnosticPatchSchema = z.object({
  steps: z.array(DiagnosticStepSchema).min(1).max(500),
  processIndex: z.number().int().min(0).optional(),
}).passthrough();

// Diagnostic chat
export const DiagnosticChatInputSchema = z.object({
  message: z.string().max(10000).optional(),
  currentSteps: z.array(z.any()).max(200).optional(),
  currentHandoffs: z.array(z.any()).max(100).optional(),
  processName: z.string().max(200).optional(),
  history: z.array(z.any()).max(100).optional(),
  incompleteInfo: z.any().optional(),
  attachments: z.array(z.any()).max(20).optional(),
  editingReportId: z.string().max(64).optional(),
  editingRedesign: z.boolean().optional(),
  redesignContext: z.string().max(20000).optional(),
  segment: z.string().max(50).optional(),
}).refine((d) => (typeof d.message === 'string' && d.message.trim().length > 0) || (Array.isArray(d.attachments) && d.attachments.length > 0), { message: 'Message or attachments required.' });

// Get dashboard DELETE
export const GetDashboardDeleteSchema = z.object({
  reportId: z.string().min(1).max(64),
}).passthrough();

// Generate redesign
export const GenerateRedesignSchema = z.object({
  reportId: z.string().uuid(),
  regenerate: z.boolean().optional(),
}).passthrough();

// Generate workflow export
export const GenerateWorkflowExportSchema = z.object({
  reportId: z.string().uuid(),
  platform: z.string().min(1).max(100),
  redesignId: z.string().max(64).optional(),
}).passthrough();

// Recommend workflow platform
export const RecommendPlatformSchema = z.object({
  reportId: z.string().uuid(),
}).passthrough();

// Team analyze action
export const TeamAnalyzeSchema = z.object({
  team: z.object({ id: z.string(), processName: z.string().optional() }).passthrough(),
  responses: z.array(z.any()).min(2).max(100),
  aggregation: z.record(z.string(), z.unknown()),
}).passthrough();
