/**
 * Methodology knowledge base for the AI Recommendations Agent.
 * Maps observed process patterns to specific guidance from established frameworks:
 *   - PRINCE2 Practitioner Guide (Axelos 2017/2023)
 *   - Lean / Toyota Production System (8 Wastes - DOWNTIME)
 *   - Six Sigma DMAIC methodology
 *   - Gartner Hyperautomation & BPM Research
 *   - ISO 9001:2015 Quality Management System
 *   - APQC Process Classification Framework
 *   - ITIL 4 Service Management
 */

/**
 * The 8 Lean Wastes (DOWNTIME mnemonic)
 */
const LEAN_WASTES = {
  D: 'Defects — rework, errors, corrections, scrapped work',
  O: 'Overproduction — producing more than needed before it is needed',
  W: 'Waiting — idle time between process steps when work is not moving',
  N: 'Non-utilised talent — skills and knowledge of people not applied to process improvement',
  T: 'Transport — unnecessary movement of materials, documents, or data between locations',
  I: 'Inventory — WIP accumulation; work queued and not flowing',
  M: 'Motion — unnecessary movement of people within a step (hunting for information, re-entering data)',
  E: 'Extra-processing — doing more work than the customer requires; gold-plating',
};

/**
 * Process maturity levels (based on CMMI / APQC maturity framework)
 */
const MATURITY_LEVELS = {
  'ad-hoc': 'Ad-hoc (Level 1): Processes are undefined, inconsistent, and dependent on individual heroics. Outcomes are unpredictable.',
  'managed': 'Managed (Level 2): Processes are planned and tracked but not yet standardised. Results are repeatable for the same team.',
  'standardised': 'Standardised (Level 3): Processes are defined, documented, and followed consistently. Training is structured.',
  'optimised': 'Optimised (Level 4): Processes are measured, controlled, and continuously improved using data.',
  'innovating': 'Innovating (Level 5): Processes leverage technology and experimentation to deliver step-change improvements.',
};

/**
 * Framework guidance library keyed by process pattern.
 * Each entry maps to one or more framework citations.
 */
const FRAMEWORK_GUIDANCE = {
  'no-process-owner': [
    {
      framework: 'PRINCE2',
      principle: 'Defined Roles & Responsibilities — Theme: Organisation',
      guidance: 'PRINCE2 mandates that every process has a single accountable owner. Without this, work falls into gaps between teams with no-one responsible for the end-to-end outcome. Assign a Process Owner role to the most accountable department and document it in the process definition.',
      source: 'PRINCE2 Practitioner Guide 2023, Theme: Organisation — Roles & Responsibilities',
    },
    {
      framework: 'ISO 9001',
      principle: 'Clause 5.3 Organisational Roles, Responsibilities and Authorities',
      guidance: 'ISO 9001:2015 Clause 5.3 requires top management to assign responsibilities for conformance of the QMS and for reporting on performance. Undocumented ownership is a non-conformance against this clause.',
      source: 'ISO 9001:2015 Clause 5.3',
    },
    {
      framework: 'APQC',
      principle: 'Process Ownership Model',
      guidance: 'APQC research shows organisations with named process owners achieve 23% better process performance scores than those without. The owner should hold authority over process design, measurement, and improvement decisions.',
      source: 'APQC Process Management Research 2024',
    },
  ],

  'no-stage-gates': [
    {
      framework: 'PRINCE2',
      principle: 'Manage by Stages — Core Principle',
      guidance: 'PRINCE2 divides work into stages with defined end-points (stage gates) where the business case is re-validated before proceeding. Without stage gates, commitment and resources flow into work that may no longer be justified. Introduce at least one formal review point at the mid-point of the process.',
      source: 'PRINCE2 Practitioner Guide 2023, Principle: Manage by Stages',
    },
  ],

  'no-risk-register': [
    {
      framework: 'PRINCE2',
      principle: 'Risk Theme — Manage by Exception',
      guidance: 'PRINCE2 Risk Theme requires all identified threats and opportunities to be logged in a Risk Register with owner, probability, impact, and response. Processes operating without risk registers accumulate unmonitored exposure that triggers crises rather than managed responses.',
      source: 'PRINCE2 Practitioner Guide 2023, Theme: Risk',
    },
  ],

  'no-quality-checks': [
    {
      framework: 'PRINCE2',
      principle: 'Quality Theme — Quality Review Technique',
      guidance: 'PRINCE2 Quality Theme requires quality criteria to be defined for each product before it is produced and reviewed against those criteria at completion. Without quality gates, errors pass downstream and cost 10-100x more to correct.',
      source: 'PRINCE2 Practitioner Guide 2023, Theme: Quality',
    },
    {
      framework: 'ISO 9001',
      principle: 'Clause 8.6 Release of Products and Services',
      guidance: 'ISO 9001:2015 Clause 8.6 requires planned arrangements for verification of products/services before release. Undocumented quality checks are a systematic non-conformance risk.',
      source: 'ISO 9001:2015 Clause 8.6',
    },
  ],

  'high-waiting-time': [
    {
      framework: 'Lean',
      principle: 'Eliminate Waiting Waste (DOWNTIME: W)',
      guidance: 'When waiting time exceeds active execution time, the process is supply-constrained or pull-triggered incorrectly. Lean prescribes converting from push (batching work and sending) to pull (downstream step signals readiness). Implement a digital trigger — automated notification, shared queue visibility, or workflow system — so the next step starts immediately when input is ready.',
      source: 'Lean Enterprise Institute — Value Stream Mapping; Womack & Jones, Lean Thinking (2003)',
    },
    {
      framework: 'Six Sigma',
      principle: 'Cycle Time Reduction — DMAIC: Analyse phase',
      guidance: 'Six Sigma DMAIC analysis would use a Time-Value Map to separate Value-Added time from Non-Value-Added waiting. Benchmark: total cycle time should be <2× active work time. Where waiting exceeds this, the root cause is typically batch-processing, missing notification, or resource unavailability.',
      source: 'ASQ Six Sigma Body of Knowledge; DMAIC Analyse Phase',
    },
  ],

  'poor-handoffs': [
    {
      framework: 'Lean',
      principle: 'Eliminate Motion Waste and Transport Waste (DOWNTIME: M, T)',
      guidance: 'Handoffs with ambiguous ownership or no structured trigger represent Motion waste (hunting for context) and Transport waste (information moving through email chains rather than shared systems). Lean prescribes: define the standard handoff protocol — what information must be complete, who triggers it, and how the recipient confirms readiness.',
      source: 'Lean Enterprise Institute — Standard Work; Rother & Shook, Learning to See (1998)',
    },
    {
      framework: 'PRINCE2',
      principle: 'Defined Roles & Responsibilities — Work Package Handoff',
      guidance: 'PRINCE2 Work Packages define exactly what is to be delivered, to whom, and under what constraints. Applying this concept at the process step level eliminates ambiguous handoffs: document the "done" criteria for each step and the information that must accompany the handoff.',
      source: 'PRINCE2 Practitioner Guide 2023, Theme: Organisation — Work Packages',
    },
  ],

  'knowledge-concentration': [
    {
      framework: 'Lean',
      principle: 'Eliminate Non-Utilised Talent Waste (DOWNTIME: N)',
      guidance: 'When process delivery depends on a single individual, the organisation is failing to leverage the full team\'s capability and creating a single point of failure. Lean addresses this through Standard Work documentation — capturing the current best method in enough detail that any trained person can perform it consistently.',
      source: 'Lean Enterprise Institute — Standard Work; Shingo Model',
    },
    {
      framework: 'ISO 9001',
      principle: 'Clause 7.2 Competence & Clause 7.3 Awareness',
      guidance: 'ISO 9001:2015 requires organisations to determine necessary competencies, ensure personnel are competent, and retain documented information as evidence. Single-person knowledge dependencies are a systematic risk against Clause 7.2 — the competence must be documented and transferable.',
      source: 'ISO 9001:2015 Clauses 7.2 and 7.3',
    },
    {
      framework: 'PRINCE2',
      principle: 'Continued Business Justification — Business Case Theme',
      guidance: 'PRINCE2 requires processes to continue to be viable when key individuals are absent. A process that stops when a specific person is on leave fails the continued viability test. Document the process and cross-train at least one backup.',
      source: 'PRINCE2 Practitioner Guide 2023, Theme: Business Case',
    },
  ],

  'too-many-approvals': [
    {
      framework: 'Lean',
      principle: 'Eliminate Extra-Processing Waste (DOWNTIME: E)',
      guidance: 'Multiple approval rounds on a single decision represent Extra-processing waste — doing more than the customer or the risk level requires. Lean prescribes Delegation of Authority matrices: define the threshold above which each level of approval is justified. Below that threshold, the closest qualified person approves.',
      source: 'Lean Enterprise Institute — Value-Add Analysis; Ohno, Toyota Production System (1978)',
    },
    {
      framework: 'PRINCE2',
      principle: 'Manage by Exception — Delegated Authority',
      guidance: 'PRINCE2 Manage by Exception defines tolerance bands within which decisions can be made at each level without escalation. Applying this principle to approvals: set financial, quality, and risk thresholds above which escalation is triggered automatically, eliminating blanket multi-approval requirements.',
      source: 'PRINCE2 Practitioner Guide 2023, Principle: Manage by Exception',
    },
  ],

  'manual-data-entry': [
    {
      framework: 'Lean',
      principle: 'Eliminate Motion + Extra-Processing Waste (DOWNTIME: M, E)',
      guidance: 'Re-entering the same data into multiple systems is textbook Motion waste (unnecessary movement of information) combined with Extra-processing (doing work the system integration should handle). Lean\'s Single Point of Entry principle prescribes that data is captured once at its source and flows automatically to all downstream consumers.',
      source: 'Lean Enterprise Institute — Eliminate Data Re-entry; Digital Lean Principles',
    },
    {
      framework: 'Gartner',
      principle: 'Hyperautomation — RPA + Integration',
      guidance: 'Gartner\'s Hyperautomation framework identifies manual data re-entry as a primary RPA target. Where a full API integration is not feasible, attended or unattended RPA provides a rapid interim solution. The priority order is: native integration first, API second, RPA third, manual last.',
      source: 'Gartner Hyperautomation Research 2024; Gartner Market Guide for RPA 2023',
    },
  ],

  'cross-department-delays': [
    {
      framework: 'Lean',
      principle: 'Eliminate Transport Waste — Value Stream Mapping',
      guidance: 'Work crossing more than two department boundaries creates compounding handoff delays. Value Stream Mapping exposes these delays as non-value-added transport. Lean solution: reduce the number of departments touching the process through consolidation or automated triggers that bypass manual notification chains.',
      source: 'Rother & Shook, Learning to See (1998); Lean Enterprise Institute',
    },
    {
      framework: 'PRINCE2',
      principle: 'Organisation Theme — Interface Management',
      guidance: 'PRINCE2 Organisation Theme requires inter-team interfaces to be formally defined, including who communicates with whom and in what format. Undocumented cross-department interfaces are the root cause of most handoff delays. Create an interface specification for each cross-department touchpoint.',
      source: 'PRINCE2 Practitioner Guide 2023, Theme: Organisation',
    },
  ],

  'rework-loops': [
    {
      framework: 'Lean',
      principle: 'Eliminate Defects Waste — Poka-Yoke (DOWNTIME: D)',
      guidance: 'Rework loops indicate defects passing through the process rather than being caught at source. Lean prescribes Poka-Yoke (mistake-proofing): design the process so the error is impossible or immediately detected. Practical applications: mandatory field validation, automated completeness checks before handoff, standardised templates with required fields.',
      source: 'Shingo, Zero Quality Control (1986); Lean Enterprise Institute — Mistake-Proofing',
    },
    {
      framework: 'Six Sigma',
      principle: 'DMAIC — Root Cause Analysis (Analyse Phase)',
      guidance: 'Six Sigma DMAIC: use Fishbone (Ishikawa) and 5-Why analysis to identify the root cause of rework. In most service processes, rework root causes fall into: unclear input requirements, no quality check at step entry, or unclear owner accountability. Fix the root cause, not the symptom.',
      source: 'ASQ Six Sigma Body of Knowledge; DMAIC Analyse Phase',
    },
    {
      framework: 'ISO 9001',
      principle: 'Clause 8.7 Control of Nonconforming Outputs',
      guidance: 'ISO 9001:2015 Clause 8.7 requires identification and control of outputs that do not conform to requirements, with documented nonconformity records and corrective action. Recurring rework without documented NCRs represents a systematic non-conformance.',
      source: 'ISO 9001:2015 Clause 8.7',
    },
  ],

  'bottleneck-at-approval': [
    {
      framework: 'Lean',
      principle: 'Eliminate Inventory Waste — WIP Limits (DOWNTIME: I)',
      guidance: 'A bottleneck at an approval step creates an Inventory waste: work-in-progress queued waiting for sign-off. Lean prescribes WIP limits and Kanban: cap the queue in front of the bottleneck to make the constraint visible, and apply Theory of Constraints to elevate the constraint (parallel approvals, delegated authority, or pre-approved templates).',
      source: 'Goldratt, The Goal (1984) — Theory of Constraints; Lean Enterprise Institute',
    },
    {
      framework: 'PRINCE2',
      principle: 'Manage by Exception — Approval Delegation',
      guidance: 'PRINCE2 Manage by Exception: if approval bottlenecks are recurring, the approval authority is set too high for the risk level involved. Define tolerance bands and delegate approval authority to the level closest to the work. Reserve senior approvals for exceptions that exceed defined thresholds.',
      source: 'PRINCE2 Practitioner Guide 2023, Principle: Manage by Exception',
    },
  ],

  'long-cycle-time': [
    {
      framework: 'Six Sigma',
      principle: 'DMAIC — Measure & Analyse: Cycle Time vs Benchmark',
      guidance: 'Six Sigma baseline measurement against industry benchmarks (APQC PCF) quantifies the gap. A process running at 2-3× the industry median cycle time typically has multiple contributing factors: batch processing, approval bottlenecks, and rework loops. DMAIC improvement order: reduce waiting time first (largest lever), then reduce rework, then eliminate unnecessary steps.',
      source: 'ASQ Six Sigma Body of Knowledge; APQC Benchmarking Methodology',
    },
    {
      framework: 'Lean',
      principle: 'Value Stream Mapping — Lead Time Reduction',
      guidance: 'A Value Stream Map distinguishes Value-Added time (work the customer pays for) from Non-Value-Added time (everything else). In most professional service processes, only 10-30% of elapsed time is value-adding. The improvement target: bring cycle time closer to the sum of value-adding steps only.',
      source: 'Rother & Shook, Learning to See (1998); Lean Enterprise Institute',
    },
  ],

  'no-process-metrics': [
    {
      framework: 'Gartner',
      principle: 'Process Mining — Prerequisite: Event Log Data',
      guidance: 'Gartner identifies process metrics as the prerequisite for Process Mining and intelligent automation. Without baseline metrics (cycle time, error rate, cost per instance), it is impossible to prioritise improvements or measure ROI. Implement at minimum: cycle time tracking, first-pass yield, and volume per period.',
      source: 'Gartner Magic Quadrant for Process Mining 2024',
    },
    {
      framework: 'ISO 9001',
      principle: 'Clause 9.1 Monitoring, Measurement, Analysis and Evaluation',
      guidance: 'ISO 9001:2015 Clause 9.1 requires organisations to determine what needs to be monitored, the methods to be used, when results shall be analysed, and when results shall be reported. Operating without process metrics is a systematic gap against this clause.',
      source: 'ISO 9001:2015 Clause 9.1',
    },
  ],

  'manual-repetitive-tasks': [
    {
      framework: 'Gartner',
      principle: 'Hyperautomation — RPA + AI Orchestration',
      guidance: 'Gartner\'s Hyperautomation framework: identify all manual repetitive tasks that follow defined rules, prioritise by volume × time-per-instance, and automate the highest-value items first. The typical progression is: document the current manual process → automate with RPA → enhance with AI for variable inputs → integrate fully via API.',
      source: 'Gartner Top Strategic Technology Trends 2024 — Hyperautomation',
    },
  ],

  'process-variant-proliferation': [
    {
      framework: 'Gartner',
      principle: 'Digital Twin of the Organisation (DTO)',
      guidance: 'Gartner\'s DTO concept: when process variants multiply without governance, the organisation loses its ability to understand, optimise, or automate. Use process mining to discover actual variant frequency, then rationalise: standardise the most common variant, create documented exception paths for legitimate variants, and retire informal workarounds.',
      source: 'Gartner Digital Twin of the Organisation Research 2024',
    },
  ],

  'no-documented-procedures': [
    {
      framework: 'ISO 9001',
      principle: 'Clause 7.5 Documented Information',
      guidance: 'ISO 9001:2015 Clause 7.5 requires documented information necessary for the effectiveness of the QMS to be maintained and controlled. Processes operating without documented procedures cannot be consistently performed, trained, audited, or improved. Document the current best-practice method as a minimum.',
      source: 'ISO 9001:2015 Clause 7.5',
    },
  ],

  'no-quality-objectives': [
    {
      framework: 'ISO 9001',
      principle: 'Clause 6.2 Quality Objectives',
      guidance: 'ISO 9001:2015 Clause 6.2 requires quality objectives to be measurable, monitored, communicated, and updated. Without defined quality objectives for the process, there is no agreed standard to improve toward. Define at least one measurable quality objective per process (e.g. "95% of outputs meet agreed specification on first pass").',
      source: 'ISO 9001:2015 Clause 6.2',
    },
  ],

  'customer-feedback-missing': [
    {
      framework: 'ISO 9001',
      principle: 'Clause 9.1.2 Customer Satisfaction',
      guidance: 'ISO 9001:2015 Clause 9.1.2 requires organisations to monitor customer perception of the degree to which their needs and expectations are fulfilled. Without feedback capture, process improvements risk being directed at internally-visible waste rather than customer-impacting issues.',
      source: 'ISO 9001:2015 Clause 9.1.2',
    },
  ],
};

/**
 * Maps observed patterns to applicable Lean waste categories.
 */
const PATTERN_TO_LEAN_WASTE = {
  'high-waiting-time': ['W — Waiting'],
  'poor-handoffs': ['M — Motion', 'T — Transport'],
  'knowledge-concentration': ['N — Non-utilised talent'],
  'too-many-approvals': ['E — Extra-processing', 'I — Inventory (approval queue)'],
  'manual-data-entry': ['M — Motion', 'E — Extra-processing'],
  'cross-department-delays': ['T — Transport', 'W — Waiting'],
  'rework-loops': ['D — Defects'],
  'bottleneck-at-approval': ['I — Inventory', 'W — Waiting'],
  'long-cycle-time': ['W — Waiting', 'I — Inventory'],
  'no-process-owner': ['N — Non-utilised talent'],
  'manual-repetitive-tasks': ['M — Motion', 'E — Extra-processing'],
  'process-variant-proliferation': ['E — Extra-processing', 'D — Defects'],
  'no-documented-procedures': ['N — Non-utilised talent', 'D — Defects'],
  'no-process-metrics': ['E — Extra-processing'],
  'customer-feedback-missing': ['N — Non-utilised talent'],
};

/**
 * Maps pattern profiles to process maturity level.
 */
function assessMaturityLevel(patterns) {
  const criticalGaps = ['no-process-owner', 'no-documented-procedures', 'knowledge-concentration'];
  const managedGaps = ['no-process-metrics', 'rework-loops', 'too-many-approvals'];
  const optimisationGaps = ['high-waiting-time', 'manual-data-entry', 'bottleneck-at-approval'];

  const criticalCount = patterns.filter(p => criticalGaps.includes(p)).length;
  const managedCount = patterns.filter(p => managedGaps.includes(p)).length;

  if (criticalCount >= 2) return 'ad-hoc';
  if (criticalCount === 1 || managedCount >= 2) return 'managed';
  if (managedCount === 1 || patterns.length >= 3) return 'standardised';
  if (patterns.length >= 1) return 'optimised';
  return 'innovating';
}

/**
 * Generates framework-aligned methodology guidance for observed process patterns.
 *
 * @param {string[]} patterns - Array of pattern identifiers observed in the diagnostic data.
 *   Valid values: 'high-waiting-time', 'poor-handoffs', 'knowledge-concentration',
 *   'too-many-approvals', 'no-process-owner', 'manual-data-entry',
 *   'cross-department-delays', 'rework-loops', 'bottleneck-at-approval',
 *   'long-cycle-time', 'no-process-metrics', 'manual-repetitive-tasks',
 *   'process-variant-proliferation', 'no-documented-procedures',
 *   'no-quality-objectives', 'customer-feedback-missing', 'no-stage-gates',
 *   'no-risk-register', 'no-quality-checks'
 * @returns {object} Methodology guidance object.
 */
export function getMethodologyGuidance(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    patterns = ['no-process-metrics'];
  }

  // Collect all applicable framework guidance without duplicates
  const frameworkMap = new Map();
  for (const pattern of patterns) {
    const guidance = FRAMEWORK_GUIDANCE[pattern] || [];
    for (const g of guidance) {
      const key = `${g.framework}::${g.principle}`;
      if (!frameworkMap.has(key)) {
        frameworkMap.set(key, g);
      }
    }
  }

  const applicableFrameworks = [...frameworkMap.values()];

  // Collect Lean wastes
  const leanWasteSet = new Set();
  for (const pattern of patterns) {
    const wastes = PATTERN_TO_LEAN_WASTE[pattern] || [];
    wastes.forEach(w => leanWasteSet.add(w));
  }
  const leanWastes = [...leanWasteSet];

  // Maturity assessment
  const maturityKey = assessMaturityLevel(patterns);
  const maturityLevel = maturityKey;

  // Priority actions - ordered by impact (critical gaps first)
  const priorityActions = generatePriorityActions(patterns, applicableFrameworks);

  return {
    applicableFrameworks,
    leanWastes,
    maturityLevel,
    priorityActions,
  };
}

/**
 * Generates prioritised action list from patterns and framework guidance.
 */
function generatePriorityActions(patterns, frameworks) {
  const actions = [];

  // Critical governance gaps first
  if (patterns.includes('no-process-owner')) {
    actions.push('Assign a named Process Owner to each process — the single role accountable for end-to-end outcome (PRINCE2: Organisation Theme; ISO 9001 Clause 5.3)');
  }
  if (patterns.includes('knowledge-concentration')) {
    actions.push('Document the current best-practice method as Standard Work and cross-train at least one backup — eliminating single-person dependency (Lean Standard Work; ISO 9001 Clause 7.2)');
  }
  if (patterns.includes('no-documented-procedures')) {
    actions.push('Create documented process procedures capturing the current best method — prerequisite for training, auditing, and automation (ISO 9001:2015 Clause 7.5)');
  }

  // High-impact waste elimination
  if (patterns.includes('high-waiting-time')) {
    actions.push('Convert from push to pull triggering: implement automated notifications so the next step starts immediately when input is ready, eliminating idle waiting (Lean: Eliminate Waiting Waste)');
  }
  if (patterns.includes('rework-loops')) {
    actions.push('Apply Poka-Yoke at the step that generates defects: add mandatory completeness checks or validation before handoff to prevent errors passing downstream (Lean: Defects Waste; Six Sigma DMAIC)');
  }
  if (patterns.includes('too-many-approvals')) {
    actions.push('Define a Delegation of Authority matrix: set financial and risk thresholds above which escalation is justified; remove approval steps that add sign-off without adding risk oversight (PRINCE2: Manage by Exception; Lean: Extra-processing Waste)');
  }
  if (patterns.includes('manual-data-entry')) {
    actions.push('Implement single point of entry: capture data once at source and automate propagation to downstream systems — eliminating re-entry waste and associated error rate (Lean: Motion Waste; Gartner Hyperautomation)');
  }
  if (patterns.includes('bottleneck-at-approval')) {
    actions.push('Apply WIP limits at the approval bottleneck to make capacity constraint visible, then elevate it: parallel approvals, delegated authority, or pre-approved template decisions (Lean: Inventory Waste; Theory of Constraints)');
  }
  if (patterns.includes('poor-handoffs')) {
    actions.push('Define a standard handoff protocol for each cross-team transition: document what information must be complete, the trigger method, and how the recipient confirms readiness (PRINCE2: Work Packages; Lean: Transport Waste)');
  }

  // Measurement and continuous improvement
  if (patterns.includes('no-process-metrics')) {
    actions.push('Implement minimum baseline metrics — cycle time, first-pass yield, and volume per period — as prerequisite for data-driven improvement and automation ROI measurement (ISO 9001 Clause 9.1; Gartner Process Mining prerequisite)');
  }

  // Limit to 6 actions, prioritised by position in list
  return actions.slice(0, 6);
}
