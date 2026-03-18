/**
 * Industry knowledge base for the AI Recommendations Agent.
 * Content is grounded in published benchmarks:
 *   - APQC Process Classification Framework (PCF) 2024
 *   - Gartner BPM / Hyperautomation Research
 *   - ISO 9001:2015, ISO/IEC 27001, ISO 13485
 *   - PRINCE2 Practitioner Guide (Axelos)
 *   - Lean / Six Sigma body of knowledge
 *   - NHS England Operational Standards / NHS Improvement
 *   - FCA Operational Resilience Rules (PS21/3)
 *   - CITB Construction Industry benchmarks
 *   - ITIL 4 Service Management
 */

const INDUSTRY_DATA = {
  'Technology & Software': {
    industry: 'Technology & Software',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 5, worst: 21 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'high',
      avgReworkRate: '8-12%',
    },
    commonWastePatterns: [
      'Context-switching overhead: engineers handling support tickets mid-sprint disrupts flow and adds ~2h recovery time per interruption (DORA Research 2023)',
      'Approval bottlenecks on deployment pipelines: manual sign-offs on routine releases add 1-3 day delays on average (DORA State of DevOps 2023)',
      'Undocumented tribal knowledge causing on-boarding drag: new hires take 3-6 months to reach full productivity vs 4-8 weeks with documented runbooks',
      'Excessive meeting overhead: tech teams average 23% of working hours in meetings, of which Gartner estimates 40% add no decision value',
      'Duplicate data entry between ticketing systems (e.g. Jira → CRM → support desk) costing 45-90 min per week per person',
      'Late-stage QA: defects found in production cost 15-25x more to fix than those caught at code review stage (IBM Systems Sciences Institute)',
    ],
    regulatoryContext: 'GDPR (data handling in software products), ISO/IEC 27001 (information security), SOC 2 Type II (for SaaS products), OWASP guidelines, PCI-DSS if payment processing applies.',
    automationOpportunities: [
      'CI/CD pipeline automation: automated build, test, and deploy reduces deployment lead time from days to hours (DORA benchmark)',
      'Automated code review gates (SonarQube, Snyk) replacing manual security checks on every PR',
      'Automated customer onboarding workflows (provisioning, email sequences, licence activation)',
      'ChatOps integration: Slack/Teams bots for incident triage and escalation routing, cutting MTTR by 30-50%',
    ],
    recommendedFrameworks: ['DORA Metrics', 'ITIL 4', 'SAFe / Scrum', 'ISO/IEC 27001', 'APQC PCF'],
    keyRisks: [
      'Key-person dependency on undocumented system architecture (bus factor = 1)',
      'Security review bypassed under delivery pressure, creating compliance exposure',
      'Customer escalation loop caused by lack of SLA-tracked handoff from Sales to Implementation',
      'Scope creep driven by informal change requests outside sprint governance',
    ],
    industryBenchmarkSource: 'APQC PCF 2024; DORA State of DevOps 2023; Gartner BPM Research 2024',
  },

  'Financial Services & Banking': {
    industry: 'Financial Services & Banking',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 7, worst: 30 },
      optimalHandoffsPerProcess: 4,
      automationMaturity: 'high',
      avgReworkRate: '10-15%',
    },
    commonWastePatterns: [
      'Manual reconciliation between core banking and reporting systems: APQC benchmarks show best-in-class firms complete reconciliation in <1 day; median is 3-5 days',
      'Duplicate KYC data collection across product lines: customers re-submit the same identity documents for each new product, adding 3-5 days to onboarding',
      'Paper-based audit trails for compliance sign-off, requiring manual indexing and storage — typical cost £15-40 per document in admin overhead',
      'Over-approval culture: routine credit decisions requiring 3+ sign-offs when policy supports single-approver delegation under defined thresholds',
      'Handoff delays between front-office origination and back-office processing, with an average 48h queue in mid-tier banks (FCA thematic review 2022)',
      'Re-keying customer data from email/PDF applications into core systems, introducing a 2-4% error rate requiring downstream correction',
    ],
    regulatoryContext: 'FCA SYSC/CASS rules, PSD2 (open banking), GDPR, Basel III capital requirements, AML (POCA 2002, MLR 2017), SMCR accountability regime, FCA Operational Resilience PS21/3 (12-week recovery tolerance), DORA (EU Digital Operational Resilience Act).',
    automationOpportunities: [
      'RPA for straight-through processing on low-risk credit applications (reducing human touch from 45 min to <5 min per case)',
      'Automated KYC/AML screening via API integrations (Refinitiv, LexisNexis) replacing manual database checks',
      'Intelligent document processing (IDP) for mortgage/loan application ingestion, cutting processing time by 60-70%',
      'Real-time reconciliation automation between ledgers, reducing month-end close from 5 days to 1 day (APQC top quartile)',
    ],
    recommendedFrameworks: ['APQC PCF for Financial Services', 'Lean Six Sigma', 'ITIL 4', 'ISO 9001:2015', 'PRINCE2'],
    keyRisks: [
      'Regulatory breach due to manual audit trail gaps in SMCR-regulated decisions',
      'Operational resilience failure: single-point-of-failure in critical payment processing not identified (FCA PS21/3)',
      'Fraud exposure window extended by slow manual transaction review (AML requirement)',
      'Customer detriment from opaque complaint-handling process breaching FCA DISP rules',
    ],
    industryBenchmarkSource: 'APQC PCF Financial Services 2024; FCA Thematic Review 2022; Gartner Hyperautomation in Banking 2023',
  },

  'Healthcare & Life Sciences': {
    industry: 'Healthcare & Life Sciences',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 5, worst: 28 },
      optimalHandoffsPerProcess: 4,
      automationMaturity: 'medium',
      avgReworkRate: '15-20%',
    },
    commonWastePatterns: [
      'Patient administration duplication: clinical and admin staff re-enter the same patient data in 2-3 separate systems (PAS, EPR, referral portal), costing ~25 min per patient episode',
      'Waiting time dominates cycle time: NHS Improvement data shows active clinical time averages 20% of total pathway time; 80% is waiting or administrative delay',
      'Referral-to-treatment (RTT) delays caused by paper referral letters requiring manual scanning, coding, and routing — adding 3-7 days on average',
      'Consent form management: paper-based processes with an 8-12% error/missing-field rate requiring re-work at point of procedure',
      'Medication reconciliation gaps at care transitions: NICE Patient Safety Alert cites omissions at handover as a leading cause of adverse events',
      'Clinic slot waste: NHS England benchmark shows 15-25% first-appointment non-attendance with no automated reminder process',
    ],
    regulatoryContext: 'CQC fundamental standards (Health & Social Care Act 2008), GDPR / Data Security & Protection Toolkit (DSP Toolkit), NHS Digital standards, MHRA (medical devices/medicines), NICE guidelines, Caldicott Guardian principles (patient data), ISO 13485 (medical devices QMS), GxP (GMP/GLP/GCP for life sciences research).',
    automationOpportunities: [
      'Automated appointment reminders via SMS/email reducing DNA (Did Not Attend) rate from 15-25% to 5-8% (NHS GIRFT data)',
      'Electronic referral routing via e-RS replacing paper referrals, cutting 3-7 day delay to same-day',
      'Automated medication reconciliation alerts at care transitions (EPR integration)',
      'Digital consent management platforms replacing paper, reducing consent-related delays by ~80%',
      'Automated reporting to NHSE/CQC from EPR data, replacing manual monthly extracts',
    ],
    recommendedFrameworks: ['NHS GIRFT (Getting It Right First Time)', 'NHS Lean / Model for Improvement', 'ISO 9001:2015', 'ISO 13485', 'PRINCE2'],
    keyRisks: [
      'Patient safety incident caused by undocumented escalation pathway when key clinical role is absent',
      'CQC enforcement action due to poorly documented care records (Regulation 17)',
      'RTT breach creating reputational and contractual penalty risk',
      'Information governance breach from unsecured paper-based referrals (GDPR/DSP Toolkit)',
    ],
    industryBenchmarkSource: 'NHS Improvement Operational Standards 2024; NHS GIRFT 2023; APQC Healthcare PCF 2024',
  },

  'Manufacturing & Engineering': {
    industry: 'Manufacturing & Engineering',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 8, worst: 35 },
      optimalHandoffsPerProcess: 4,
      automationMaturity: 'medium',
      avgReworkRate: '5-10%',
    },
    commonWastePatterns: [
      'Overproduction of work orders beyond actual demand signals, creating WIP inventory backlogs and tying up £50K-£200K of working capital in mid-size plants (Lean Enterprise Institute)',
      'Transport waste: parts travelling more than 3 times between processing stations due to poor facility layout (Shingo Prize methodology)',
      'Motion waste: operators walking >1 mile per shift to retrieve tools/materials not within arm-reach (time-motion studies show 15-20% of shift time lost)',
      'Waiting at machine changeover: average SMED opportunity of 30-50% reduction in setup time in batch manufacturers not using standardised setup procedures',
      'Over-processing: applying tighter tolerances than customer specifications require, consuming extra machining time with no customer benefit',
      'Defect rework: first-pass yield below 95% (industry benchmark >98%) indicating inadequate poka-yoke at process entry points',
    ],
    regulatoryContext: 'ISO 9001:2015 (Quality Management System), ISO 14001 (Environmental), ISO 45001 (Health & Safety), CE/UKCA marking (product conformity), REACH regulations (chemical substances), HSE PUWER/LOLER (equipment safety), ITAR/EAR if defence components apply.',
    automationOpportunities: [
      'MES (Manufacturing Execution System) integration with ERP to eliminate manual job card transcription, reducing data entry errors by 90%',
      'Automated visual inspection using machine vision replacing 100% manual inspection, cutting inspection time by 70% and improving defect detection rate',
      'SMED (Single Minute Exchange of Die): standardised setup procedures with digital guides reducing changeover from 2h to <30 min',
      'Predictive maintenance scheduling via IoT sensor data, reducing unplanned downtime by 25-40% (McKinsey Industry 4.0)',
    ],
    recommendedFrameworks: ['Lean Manufacturing / Toyota Production System', 'Six Sigma DMAIC', 'ISO 9001:2015', 'APQC PCF Manufacturing', 'OEE (Overall Equipment Effectiveness)'],
    keyRisks: [
      'Unplanned downtime on critical path machines due to reactive-only maintenance regime',
      'ISO 9001 non-conformance from undocumented process changes (Clause 8.1 Operational Planning)',
      'Supply chain single-source dependency creating schedule risk on key components',
      'Operator safety incident from undocumented LOTO (Lockout/Tagout) procedure during maintenance',
    ],
    industryBenchmarkSource: 'APQC PCF Manufacturing 2024; Lean Enterprise Institute; McKinsey Industry 4.0 Report 2023',
  },

  'Retail & E-commerce': {
    industry: 'Retail & E-commerce',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 3, worst: 14 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'medium',
      avgReworkRate: '8-15%',
    },
    commonWastePatterns: [
      'Manual stock count reconciliation: physical counts averaging 2-4 times per year consuming 3-5 days of store staff time, with 2-4% variance rate triggering write-offs',
      'Returns processing backlog: average 5-10 day lag between receipt of return and credit/exchange processing in non-automated environments (APQC Retail 2024)',
      'Promotional price setup errors from manual price change processes, causing margin leakage averaging 0.5-1.5% of promotional revenue',
      'Purchase order re-work: 15-25% of POs require amendment post-issue due to incomplete supplier data held in multiple spreadsheets',
      'Customer service ticket re-routing: average 2.3 handoffs before resolution in fragmented CRM environments, each adding 4-8h delay',
      'Inventory forecasting via spreadsheet causing over-stock (tying up capital) or stock-outs (losing 4-8% of potential sales per event)',
    ],
    regulatoryContext: 'Consumer Rights Act 2015, Consumer Contracts Regulations 2013 (distance selling/returns), GDPR/UK GDPR (customer data), PCI-DSS (payment card data), Trading Standards (pricing accuracy), Packaging Regulations (EPR 2025 extended producer responsibility).',
    automationOpportunities: [
      'Automated replenishment triggering purchase orders when stock falls below dynamic min/max thresholds, reducing stock-out events by 30-50%',
      'AI-powered demand forecasting replacing spreadsheet models, improving forecast accuracy from 70% to 85-90%',
      'Automated returns processing with pre-printed labels and instant credit triggers reducing returns cycle from 7 days to 24h',
      'Personalised email/SMS automation for abandoned basket recovery (typical 10-15% conversion on automated recovery campaigns)',
    ],
    recommendedFrameworks: ['APQC PCF Retail', 'Lean Retail', 'ISO 9001:2015', 'NRF Retail Operations Standards', 'Six Sigma DMAIC'],
    keyRisks: [
      'Pricing error causing regulatory Trading Standards action and reputational damage',
      'GDPR breach through unsecured customer purchase data in legacy systems',
      'Stock-out on hero SKUs during promotional periods due to poor forecasting',
      'Supplier SLA breach undetected due to lack of automated PO tracking',
    ],
    industryBenchmarkSource: 'APQC PCF Retail/E-commerce 2024; NRF Operations Benchmark 2023; Gartner Supply Chain Research 2024',
  },

  'Professional Services': {
    industry: 'Professional Services',
    benchmarks: {
      typicalProcessCycleDays: { best: 2, median: 10, worst: 45 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'low',
      avgReworkRate: '12-18%',
    },
    commonWastePatterns: [
      'Non-billable administrative overhead: APQC benchmarks show professional services firms spend 25-35% of fee-earner time on non-billable admin; best-in-class achieve <18%',
      'Knowledge locked in email: critical project context, decisions, and client commitments stored only in individual inboxes — unavailable when that person is absent',
      'Proposal re-work: 30-40% of proposals contain recycled content from previous bids that requires manual updating, with errors slipping through (Qvidian Proposal Survey)',
      'Time recording lag: entries made days or weeks after work performed introduce a 5-10% revenue leakage through under-recording billable activity',
      'Onboarding document collection: client onboarding requiring 8-15 separate document requests via email with no tracking, averaging 3-4 chaser rounds',
      'No resource utilisation visibility: project managers cannot see team capacity in real time, leading to simultaneous over-commitment and under-utilisation across the firm',
    ],
    regulatoryContext: 'Professional indemnity insurance requirements, GDPR (client data), anti-money laundering (MLR 2017 for accountants/solicitors), ICAEW/SRA/RICS professional body conduct rules, Companies Act 2006 compliance obligations.',
    automationOpportunities: [
      'Automated time capture integrations (calendar/email to timekeeping) reducing time-recording lag and increasing billable capture by 5-10%',
      'Proposal/engagement letter automation via templates with client data merge, cutting proposal prep time from 4h to <1h',
      'Automated client onboarding portal with document checklist, e-signature, and progress tracking replacing email chains',
      'Resource utilisation dashboard (live visibility of capacity vs demand) enabling proactive staffing decisions',
    ],
    recommendedFrameworks: ['PRINCE2', 'APQC PCF Professional Services', 'ISO 9001:2015', 'Lean for Services', 'PSA (Professional Services Automation) standards'],
    keyRisks: [
      'Key-person dependency: single fee-earner holding all client context, creating churn risk and delivery failure when absent',
      'Scope creep from undocumented change requests eroding project margin',
      'Professional indemnity exposure from undocumented advice trail',
      'Revenue leakage from time not recorded or under-billed due to manual timesheet process',
    ],
    industryBenchmarkSource: 'APQC PCF Professional Services 2024; Gartner Professional Services Research 2023; SPI Research PS Maturity Model 2024',
  },

  'Government & Public Sector': {
    industry: 'Government & Public Sector',
    benchmarks: {
      typicalProcessCycleDays: { best: 3, median: 15, worst: 90 },
      optimalHandoffsPerProcess: 5,
      automationMaturity: 'low',
      avgReworkRate: '20-30%',
    },
    commonWastePatterns: [
      'Multi-layer authorisation chains: routine decisions requiring 4-7 sign-offs through hierarchical approval, adding 5-20 days to cycle time (Cabinet Office Efficiency Review)',
      'Paper-based application processing: forms requiring physical collection, manual data entry, and filing — costing 3-8x more per transaction than digital equivalents (GDS Service Standard research)',
      'Duplicate citizen data across departmental silos: same individual information held in 3-5 separate systems with no synchronisation, causing re-verification overhead on each contact',
      'Correspondence backlog: FOI and ministerial correspondence queues averaging 15-20 days in large departments, with manual routing adding 2-4 days per item',
      'Budget re-approval cycles at year-end causing spend surge and artificial deadline pressure, consuming officer time that could be used on service delivery',
      'Procurement over-process: below-threshold purchases going through full tender procedures, adding 20-30 days when framework agreements or delegated authority should apply',
    ],
    regulatoryContext: 'Public Contracts Regulations 2015 (procurement), Freedom of Information Act 2000, GDPR/Data Protection Act 2018, Government Security Classifications Policy, WCAG 2.1 (digital accessibility), GDS Service Standard, Public Sector Equality Duty (Equality Act 2010), Accounts Direction (HM Treasury).',
    automationOpportunities: [
      'Digital application forms replacing paper, with automated eligibility screening reducing processing time from weeks to days (GDS benchmark)',
      'Automated correspondence routing and triage via NLP, cutting manual sorting time by 60-80%',
      'Case management automation for routine benefits/licensing decisions within defined rules (freeing officers for complex cases)',
      'Single Customer Record integrating departmental data to eliminate re-verification overhead',
    ],
    recommendedFrameworks: ['GDS Service Standard', 'PRINCE2', 'APQC PCF Public Sector', 'ITIL 4', 'ISO 9001:2015', 'Cabinet Office Functional Standards'],
    keyRisks: [
      'Ministerial or Parliamentary accountability gap from undocumented decision trails',
      'GDPR breach through insecure handling of citizen sensitive data across departments',
      'Procurement irregularity creating audit finding (NAO/PAC scrutiny)',
      'Service failure and reputational damage from process collapse when single experienced officer is absent',
    ],
    industryBenchmarkSource: 'Cabinet Office Efficiency Review 2023; GDS Service Standard Research 2024; APQC PCF Public Sector 2024',
  },

  'Non-profit & Charities': {
    industry: 'Non-profit & Charities',
    benchmarks: {
      typicalProcessCycleDays: { best: 2, median: 12, worst: 60 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'low',
      avgReworkRate: '18-25%',
    },
    commonWastePatterns: [
      'Grant reporting duplication: programme teams re-entering the same activity data in different formats for each funder, with some charities managing 15-20 separate reporting templates',
      'Volunteer management via spreadsheet: manual scheduling, communications, and hours tracking causing double-bookings and 10-15% under-utilisation of volunteer capacity',
      'Donor data fragmentation: donor records spread across CRM, spreadsheets, and email — preventing cohesive stewardship and costing an estimated 3-5% in preventable lapsed donors',
      'Trustee paper board packs: preparing and distributing physical board packs consuming 2-3 days of staff time per meeting, with version control errors',
      'Manual gift aid processing: 40-60% of eligible donations not claimed due to administrative process burden (HMRC Gift Aid statistics)',
      'Programme evaluation lag: outcomes data collected on paper and transcribed weeks after delivery, reducing usefulness for real-time programme management',
    ],
    regulatoryContext: 'Charity Commission (CC29 internal controls, SORP accounting), Gift Aid requirements (HMRC), GDPR/UK GDPR (beneficiary/donor data), Modern Slavery Act 2015 (larger charities), Fundraising Regulator Code of Practice, Companies Act 2006 (if CIO or company limited by guarantee).',
    automationOpportunities: [
      'Automated gift aid claim generation from CRM donor records, recovering 25-40% more gift aid per year',
      'Centralised grant management system with automated funder reporting reducing reporting workload by 40-60%',
      'Digital volunteer management platform replacing spreadsheets, with automated shift reminders cutting no-show rate',
      'Online board portal (Boardpacks) replacing paper packs, with version control and digital approval',
    ],
    recommendedFrameworks: ['NCVO Good Governance Code', 'SORP (Accounting & Reporting)', 'ISO 9001:2015 (adapted)', 'Lean for Nonprofits', 'APQC PCF Non-profit'],
    keyRisks: [
      'Charity Commission inquiry triggered by failure to demonstrate proper internal controls (CC29)',
      'Gift aid clawback from HMRC due to inadequate declaration records',
      'GDPR breach involving beneficiary sensitive data (special category)',
      'Funding gap from grant non-compliance due to poor programme monitoring and reporting',
    ],
    industryBenchmarkSource: 'NCVO Almanac 2024; Charity Commission CC29; APQC PCF Non-profit 2024; HMRC Gift Aid Statistics 2023',
  },

  'Construction & Real Estate': {
    industry: 'Construction & Real Estate',
    benchmarks: {
      typicalProcessCycleDays: { best: 5, median: 21, worst: 120 },
      optimalHandoffsPerProcess: 5,
      automationMaturity: 'low',
      avgReworkRate: '10-15%',
    },
    commonWastePatterns: [
      'Drawing version control failures: 30-40% of rework on construction projects is attributable to working from superseded drawings (CIOB Rework Report 2023)',
      'Subcontractor procurement via email/phone: no audit trail, no standardised scope, leading to variation claim disputes costing 3-8% of contract value on average',
      'RFI (Request for Information) backlog: average RFI response time of 7-14 days in large projects vs a 3-day target, blocking downstream trades',
      'Manual daily site reports: site managers spending 45-90 min/day on paper-based reporting that duplicates information already in their schedule',
      'Duplicate material take-offs: estimating and procurement doing separate quantity counts from the same drawings due to no shared BIM model',
      'Snagging lists on paper: defect identification and sign-off tracking via paper snagging lists with 20-30% items requiring re-inspection due to lost paperwork',
    ],
    regulatoryContext: 'Building Safety Act 2022 (BSA — Golden Thread of information), Planning Permission requirements (TCPA 1990), CDM Regulations 2015 (health & safety on construction), Building Regulations 2010, Party Wall Act 1996, CIS (Construction Industry Scheme — HMRC), RICS professional standards, CITB levy requirements.',
    automationOpportunities: [
      'BIM (Building Information Modelling) implementation creating single source of truth for drawings, eliminating version control rework (RIBA Digital Plan of Work)',
      'Digital RFI management platform with automated routing and SLA tracking, cutting response times from 14 days to 3 days',
      'Digital snagging apps (Snagr, Fieldwire) replacing paper snagging, with photo evidence and automated sign-off tracking',
      'Automated subcontractor prequalification checks (insurance, accreditation, H&S compliance) via procurement portal',
    ],
    recommendedFrameworks: ['RIBA Plan of Work 2020', 'NEC4 Contract Management', 'ISO 9001:2015', 'CDM 2015', 'PRINCE2', 'BIM Level 2 / ISO 19650'],
    keyRisks: [
      'Building Safety Act Golden Thread breach: insufficient documentation of design/build decisions for higher-risk buildings',
      'CDM regulation non-compliance creating HSE enforcement and site closure risk',
      'Variation cost spiral from undocumented scope changes and verbal instructions',
      'Programme delay caused by RFI backlog on critical path items',
    ],
    industryBenchmarkSource: 'CIOB Rework Report 2023; RICS Construction Benchmarking 2024; CITB Industry Report 2024; APQC PCF Construction',
  },

  'Logistics & Supply Chain': {
    industry: 'Logistics & Supply Chain',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 4, worst: 21 },
      optimalHandoffsPerProcess: 4,
      automationMaturity: 'medium',
      avgReworkRate: '6-12%',
    },
    commonWastePatterns: [
      'Manual carrier booking: operations staff spending 45-90 min per shipment manually checking rates and booking via carrier portals — addressable via TMS automation',
      'Proof of delivery (POD) lag: paper PODs taking 3-7 days to reach accounts payable, delaying billing and cash collection by the same margin',
      'Inventory inaccuracy: cycle count variance exceeding 2% (best-in-class <0.5%) causing safety stock inflation and unnecessary expediting costs',
      'Exception-only management breakdown: no automated alerts when SLAs are breached, meaning problems are discovered reactively 24-72h after they occur',
      'Manual customs documentation: HS code classification done manually, with 3-5% error rate generating customs delays and potential penalty exposure',
      'Demand signal fragmentation: planners receiving orders via email, EDI, phone, and portals — no consolidated view causing batch-processing delays',
    ],
    regulatoryContext: 'HMRC CHIEF/CDS customs declarations, Import Control System (ICS2 — EU), Driver Hours regulations (EC 561/2006), GDPR (personal data in transport documents), Dangerous Goods regulations (ADR/IMDG/IATA), Modern Slavery Act 2015 (supply chain due diligence), UK Timber Regulation (UKTR).',
    automationOpportunities: [
      'TMS (Transport Management System) with automated carrier rate shopping and booking, reducing booking time from 60 min to <5 min',
      'Electronic POD with mobile scanning and instant system update, eliminating 3-7 day paper lag',
      'Automated customs classification using HS code AI tools (BorderGuru, Descartes), reducing manual classification by 80%',
      'Control tower with automated SLA breach alerts and escalation routing, shifting from reactive to proactive exception management',
    ],
    recommendedFrameworks: ['APQC PCF Supply Chain', 'SCOR (Supply Chain Operations Reference) Model', 'Lean Logistics', 'ISO 9001:2015', 'ISO 28000 (Supply Chain Security)'],
    keyRisks: [
      'Customs compliance breach causing shipment delay and financial penalty (post-Brexit UK/EU)',
      'SLA breach cluster going undetected until client escalation due to no automated monitoring',
      'Carrier concentration risk (single primary carrier) creating vulnerability to capacity shortages',
      'Working capital impact from POD delay extending cash collection cycle by 5-10 days',
    ],
    industryBenchmarkSource: 'APQC PCF Supply Chain 2024; Gartner Supply Chain Research 2024; CILT Logistics Benchmarking Report 2023',
  },

  'Education & Training': {
    industry: 'Education & Training',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 7, worst: 30 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'low',
      avgReworkRate: '15-20%',
    },
    commonWastePatterns: [
      'Manual enrolment processing: student applications requiring duplicate data entry across UCAS/MIS/SMS systems, averaging 20-30 min per record with 3-5% error rate',
      'Timetabling rework: manual timetabling consuming 40-80h of coordinator time per semester, with 15-20% of draft timetables requiring >3 revision rounds',
      'Assessment administration overhead: paper-based submission, collection, distribution to markers, and return consuming 2-4h per assessment cohort beyond the marking itself',
      'Attendance monitoring via paper registers: data entry lag of 24-48h before absence is flagged, reducing early intervention window',
      'Course content duplication: multiple lecturers independently updating similar course materials without shared content repositories, duplicating 3-5h per module per semester',
      'Awarding body re-registration: annual learner re-registration submitted via spreadsheet to awarding bodies, with 8-12% error rate causing re-submission delays',
    ],
    regulatoryContext: 'Ofsted Education Inspection Framework (EIF), OfS (Office for Students) regulations for HE, Data Protection Act 2018/GDPR (learner data), Prevent Duty (Counter-Terrorism and Security Act 2015), SEND Code of Practice 2015, Equality Act 2010, Awarding body (e.g. Pearson, City & Guilds) compliance requirements.',
    automationOpportunities: [
      'Integrated MIS/SMS platform eliminating duplicate enrolment data entry, reducing processing time from 30 min to <5 min per learner',
      'Automated attendance monitoring via LMS login/card-reader data, with same-day absence alerts to personal tutors',
      'Online assessment submission and plagiarism checking (Turnitin) integrated with gradebook, eliminating paper handling',
      'Automated awarding body registration via API, replacing manual spreadsheet submissions',
    ],
    recommendedFrameworks: ['Ofsted EIF Self-Assessment', 'APQC PCF Education', 'ISO 9001:2015', 'Lean for Education', 'QAA Quality Code (HE)'],
    keyRisks: [
      'Ofsted/OfS inspection finding from inadequate attendance monitoring and early intervention records',
      'Awarding body sanction from late or inaccurate learner registration submissions',
      'GDPR breach from unsecured learner personal data in spreadsheets shared by email',
      'Student satisfaction decline from slow feedback cycles on assessments',
    ],
    industryBenchmarkSource: 'Ofsted EIF 2023; APQC PCF Education 2024; Jisc Digital Benchmarking 2024',
  },

  'Legal & Compliance': {
    industry: 'Legal & Compliance',
    benchmarks: {
      typicalProcessCycleDays: { best: 2, median: 14, worst: 90 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'low',
      avgReworkRate: '12-18%',
    },
    commonWastePatterns: [
      'Document version proliferation: legal documents cycling through 4-8 review rounds via email attachments, with version conflicts causing re-work on 20-30% of matters',
      'Manual contract data extraction: fee earners manually reading and summarising contract terms into deal sheets — averaging 2-4h per contract for standard commercial agreements',
      'Court deadline management via individual diaries: no centralised docketing system, with 3-5% of matters experiencing a missed deadline or near-miss per year (Law Society risk guidance)',
      'Billing write-off from narrative rework: WIP narratives requiring partner revision on 25-35% of bills, adding 45-90 min per bill cycle',
      'Compliance monitoring via spreadsheet: regulatory reporting obligations tracked in shared spreadsheets with no automated deadline alerts, leading to reactive last-minute preparation',
      'KYC renewal gap: periodic KYC re-verification for existing clients managed via ad-hoc email reminders, resulting in 15-20% of clients falling outside refresh cycle',
    ],
    regulatoryContext: 'SRA Standards & Regulations (Solicitors Regulation Authority), AML/KYC requirements (MLR 2017), GDPR/Data Protection Act 2018 (client data), Legal Services Act 2007, FCA conduct rules (if regulated advice given), Accounts Rules (SRA), Lexcel quality standard.',
    automationOpportunities: [
      'Document management system (DMS) with version control and automated conflict checks, eliminating email attachment cycling',
      'Contract review AI (Luminance, Kira) for clause extraction on standard contracts, reducing review time from 3h to <30 min',
      'Centralised matter management with automated court deadline docketing and team alerts',
      'Automated KYC refresh scheduling with 90-day advance notice and status tracking',
    ],
    recommendedFrameworks: ['SRA Risk Framework', 'Lexcel Quality Standard', 'ISO 9001:2015', 'ISO/IEC 27001 (information security)', 'APQC PCF Legal'],
    keyRisks: [
      'SRA regulatory sanction from AML compliance gap (inadequate KYC documentation)',
      'Missed limitation period or court deadline causing negligence claim and PII exposure',
      'Client confidentiality breach from document management failures (GDPR + SRA confidentiality obligations)',
      'Revenue leakage from time not recorded or written off due to poor matter management',
    ],
    industryBenchmarkSource: 'SRA Risk Outlook 2024; Lexcel Benchmarking 2024; APQC PCF Legal 2024; Law Society Practice Management Survey 2023',
  },

  'Hospitality & Travel': {
    industry: 'Hospitality & Travel',
    benchmarks: {
      typicalProcessCycleDays: { best: 0.1, median: 1, worst: 7 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'medium',
      avgReworkRate: '8-14%',
    },
    commonWastePatterns: [
      'Manual rate parity checks: revenue managers manually checking OTA rate parity across 5-10 channels daily, consuming 60-90 min/day with inevitable gaps causing rate parity violations and OTA delisting risk',
      'Paper-based F&B ordering: waitstaff walking 2-3 times per order between table and POS, with 3-5% order error rate from transcription mistakes',
      'Housekeeping status synchronisation lag: rooms not updated to "clean" in PMS for 15-45 min after completion, causing front desk to oversell or delay early check-ins',
      'Group booking contract cycle: manual proposal-to-contract process for group/events bookings averaging 3-5 days, vs 24h for best-in-class digital venues',
      'Manual no-show management: no automated overbooking alerts or waitlist automation, leading to either revenue loss from empty rooms or guest inconvenience from overbooking',
      'Expense management for tour operations: manual receipt collection, data entry, and approval for guides/drivers costing £30-50 per expense report in admin overhead',
    ],
    regulatoryContext: 'Package Travel Regulations 2018 (ATOL/ABTA for travel), Food Hygiene Regulations 2006 (HACCP), GDPR (guest data), Consumer Rights Act 2015, Licensing Act 2003 (alcohol), Fire Safety Order 2005, Equality Act 2010 (accessibility), Modern Slavery Act 2015.',
    automationOpportunities: [
      'Channel Manager with real-time rate/inventory distribution to all OTAs, eliminating manual rate parity maintenance and overbooking',
      'Digital ordering (QR menu + table-side POS) eliminating paper order transcription and reducing order errors to <0.5%',
      'Housekeeping app with real-time room status sync to PMS, eliminating status lag and enabling automated upsell triggers for early check-in',
      'Automated pre-arrival upsell and personalisation emails (room upgrades, F&B pre-orders) generating 3-7% additional revenue per stay',
    ],
    recommendedFrameworks: ['APQC PCF Hospitality', 'Lean for Hospitality', 'ISO 9001:2015', 'HACCP (food safety)', 'RevPAR optimisation frameworks (STR benchmarking)'],
    keyRisks: [
      'OTA delisting from persistent rate parity violations',
      'Food safety enforcement from inadequate HACCP documentation',
      'ATOL/ABTA bonding breach from cash flow mismanagement in package travel bookings',
      'Online reputation damage from housekeeping/room readiness failures',
    ],
    industryBenchmarkSource: 'STR Global Benchmarking 2024; APQC PCF Hospitality 2024; UK Hospitality Operations Report 2023',
  },

  'Energy & Utilities': {
    industry: 'Energy & Utilities',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 10, worst: 60 },
      optimalHandoffsPerProcess: 5,
      automationMaturity: 'medium',
      avgReworkRate: '8-15%',
    },
    commonWastePatterns: [
      'Manual meter reading data entry: field readings transcribed to paper then keyed into billing systems, introducing 2-3% error rate and 3-7 day processing lag',
      'Work order management via email/phone: field dispatch managed informally with no scheduling optimisation, leading to 15-25% excess travel time vs route-optimised scheduling',
      'Asset maintenance reactive-only regime: responding to failures rather than using condition monitoring data, with reactive maintenance costing 3-5x planned maintenance per repair event',
      'Customer switch process manual steps: energy supplier switching requiring 4-7 manual data exchanges between parties, when industry best practice achieves same-day switching (Ofgem)',
      'Billing exception management: 8-15% of bills requiring manual investigation and adjustment due to estimated read errors or system data mismatches',
      'Safety documentation gaps: permit-to-work systems managed on paper with 10-15% of permits missing required sign-off elements (Energy Networks Association)',
    ],
    regulatoryContext: 'Ofgem licence conditions (supply/distribution), Gas Safety (Installation and Use) Regulations 1998, Electricity at Work Regulations 1989, Health & Safety at Work Act 1974, Environment Act 2021 (net zero reporting), ISO 55001 (asset management), NERS (National Electricity Registration Scheme), Smart metering obligations (SMETS2).',
    automationOpportunities: [
      'Smart meter data automation: direct AMI data feed to billing system eliminating manual reads and estimated bills (Ofgem Smart Metering Programme)',
      'Predictive asset maintenance using condition monitoring sensors and ML, shifting from reactive to predictive regime and reducing emergency callouts by 30-50%',
      'Route-optimised field dispatch using workforce management software, reducing travel time waste by 15-25%',
      'Automated billing exception handling for common variance patterns, reducing manual intervention from 10% to 2-3% of bills',
    ],
    recommendedFrameworks: ['ISO 55001 (Asset Management)', 'APQC PCF Utilities', 'ISO 9001:2015', 'IEC 61968/61970 (CIM standards)', 'Ofgem RIG (Regulatory Instructions)'],
    keyRisks: [
      'Ofgem enforcement from billing accuracy failures and customer complaint volumes exceeding licence thresholds',
      'Health & safety incident from permit-to-work documentation failures in live network work',
      'Regulatory non-compliance with smart metering rollout obligations',
      'Asset failure causing network outage and Guaranteed Standards of Performance (GSoP) penalties',
    ],
    industryBenchmarkSource: 'Ofgem Regulatory Accounts Framework 2024; Energy Networks Association Benchmarking 2023; APQC PCF Utilities 2024',
  },

  'Media & Marketing': {
    industry: 'Media & Marketing',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 7, worst: 30 },
      optimalHandoffsPerProcess: 3,
      automationMaturity: 'medium',
      avgReworkRate: '20-30%',
    },
    commonWastePatterns: [
      'Creative revision cycles: average 4.2 revision rounds per piece of content (Workfront State of Work 2023), with each round requiring re-briefing, re-creation, and re-review — consuming 40-60% more time than original production',
      'Brief quality gap: 60% of creative briefs rated "incomplete" by creative teams, forcing back-and-forth clarification before production can start, adding 2-5 days to average project start',
      'Media plan data fragmentation: campaign performance data sitting in 8-12 separate platform dashboards with no consolidated view, requiring 3-4h/week of manual data aggregation per campaign manager',
      'Asset management via shared drives: final assets mixed with drafts and superseded versions, causing 15-20% of projects to use the wrong version in production',
      'Approval routing via email: stakeholder approval chains losing context between email threads, with 25-35% of approvals requiring re-submission due to incomplete sign-off',
      'Campaign launch checklist not standardised: QA failures in UTM tracking, pixel firing, and audience targeting discovered post-launch, requiring reactive fixes that corrupt early campaign data',
    ],
    regulatoryContext: 'ASA/CAP Code (advertising standards), GDPR/UK GDPR (consent-based marketing), ICO PECR (cookies, email marketing), Consumer Protection from Unfair Trading Regulations 2008, CAP/BCAP broadcast rules, IAB UK standards for digital advertising.',
    automationOpportunities: [
      'DAM (Digital Asset Management) system with version control, rights management, and automated distribution, eliminating wrong-version risk',
      'Automated campaign performance reporting from consolidated data platform (Supermetrics, Funnel.io) replacing manual dashboard checking',
      'Marketing automation workflows (HubSpot, Marketo) for lead nurturing sequences replacing manual email sends',
      'Standardised brief templates with conditional logic ensuring complete briefing before creative handoff, reducing revision rounds by 30-40%',
    ],
    recommendedFrameworks: ['APQC PCF Marketing', 'Agile Marketing (SprintZero methodology)', 'ISO 9001:2015', 'IAB Campaign Management Standards', 'Lean Content Production'],
    keyRisks: [
      'ASA enforcement action from non-compliant advertising claims (especially health, finance, environmental)',
      'GDPR/ICO enforcement from non-compliant consent capture in marketing automation',
      'Campaign budget waste from undetected tracking failures discovered post-spend',
      'Brand consistency damage from DAM failures allowing superseded assets into production',
    ],
    industryBenchmarkSource: 'Workfront State of Work 2023; APQC PCF Marketing 2024; Gartner Marketing Technology Research 2024',
  },

  'Insurance': {
    industry: 'Insurance',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 8, worst: 45 },
      optimalHandoffsPerProcess: 4,
      automationMaturity: 'medium',
      avgReworkRate: '10-18%',
    },
    commonWastePatterns: [
      'Manual claims triage: first-notification-of-loss (FNOL) data entry and manual routing to appropriate handler consuming 45-90 min per claim, addressable via automated triage rules',
      'Policy endorsement re-keying: mid-term adjustment (MTA) data entered into multiple systems (PAS, reinsurance, finance) without integration, creating 3-5% data inconsistency rate',
      'Document chase-up loop: missing documents on claims and underwriting submissions chased via manual outbound calls, averaging 3-5 chase cycles per case',
      'Subrogation recovery management via spreadsheet: potential recoveries tracked in spreadsheets with 15-20% falling outside recovery window due to tracking failures',
      'Compliance checking manual process: sanctions screening and fraud indicator checks done manually, creating capacity constraints at peak submission volumes',
      'Renewal quote generation delay: manual quote preparation for complex commercial risks taking 3-7 days vs <24h for best-in-class automated quote engines',
    ],
    regulatoryContext: 'FCA ICOBS (Insurance Conduct of Business), FCA Consumer Duty (PS22/9), Solvency II / UK Solvency Framework, Lloyd\'s of London Minimum Standards (where applicable), GDPR (policyholder data), AML requirements (MLR 2017), IDD (Insurance Distribution Directive), FOS complaints handling.',
    automationOpportunities: [
      'Automated FNOL intake with digital form, immediate triage rules, and handler assignment, cutting triage time from 90 min to <5 min',
      'Straight-through processing for simple claims below defined thresholds (e.g. <£1,000 verified claims) with automated settlement trigger',
      'Automated document chasing via SMS/email with status tracking, reducing manual outbound calls by 60-70%',
      'Automated sanctions/fraud screening via API integration (ComplyAdvantage, Lexis Nexis) at point of submission rather than batch overnight',
    ],
    recommendedFrameworks: ['APQC PCF Insurance', 'Lean Six Sigma (claims cycle)', 'ISO 9001:2015', 'PRINCE2', 'Lloyd\'s Performance Management Framework'],
    keyRisks: [
      'FCA Consumer Duty breach from inadequate fair value assessment or poor complaint outcomes',
      'Solvency II/UK Solvency reporting failure from data quality issues in policy systems',
      'Fraud loss from inadequate automated screening at point of submission',
      'Regulatory action from FNOL handling breaching FCA ICOBS timescales',
    ],
    industryBenchmarkSource: 'APQC PCF Insurance 2024; FCA Insurance Sector Data 2024; Gartner Insurance Technology Research 2023',
  },

  'Pharmaceuticals & Biotech': {
    industry: 'Pharmaceuticals & Biotech',
    benchmarks: {
      typicalProcessCycleDays: { best: 3, median: 20, worst: 120 },
      optimalHandoffsPerProcess: 5,
      automationMaturity: 'medium',
      avgReworkRate: '5-10%',
    },
    commonWastePatterns: [
      'Paper-based batch records: manual completion and review of batch manufacturing records consuming 40-60h per batch in record preparation and QA review, with 8-12% requiring re-work for incomplete entries',
      'Manual deviation investigation routing: quality event (deviation/CAPA/OOS) assigned via email, with average 5-day delay before investigation owner confirmed and begins work',
      'Change control bottleneck: manufacturing process changes awaiting regulatory impact assessment in queue with average 45-day cycle vs industry target of 15 days (PDA TR60)',
      'Training record management via spreadsheet: 20-30% of training records found to have gaps at GMP inspection, requiring retrospective remediation',
      'Label management complexity: manual control of printed label inventory creating risk of label mix-up (consistently top-5 MHRA/FDA 483 observation)',
      'Out-of-specification (OOS) investigation rework: 25-35% of OOS investigations requiring re-investigation due to incomplete root cause analysis on first pass',
    ],
    regulatoryContext: 'MHRA GMP (EU GMP Annex 15, ICH Q10), FDA 21 CFR Part 211 (cGMP), ICH guidelines (Q8-Q12), GxP (GMP/GLP/GCP), EU/UK Clinical Trial Regulations, ISO 13485 (medical devices QMS), Pharmacovigilance (EU GVP), Data Integrity guidance (MHRA 2021), 21 CFR Part 11 (electronic records).',
    automationOpportunities: [
      'Electronic Batch Record (EBR) system replacing paper batch records, reducing review cycle from 60h to <10h and eliminating transcription errors',
      'Automated quality event routing with CAPA assignment, SLA tracking, and escalation alerts, cutting investigation start time from 5 days to <24h',
      'Electronic Training Management System (eTMS) with automatic competency expiry alerts and training assignment triggered by role/SOP change',
      'Label printing automation with verified label management system, eliminating manual label inventory control',
    ],
    recommendedFrameworks: ['ICH Q10 Pharmaceutical Quality System', 'PDA Technical Reports (TR29, TR60)', 'ISO 9001:2015 / ISO 13485', 'APQC PCF Pharma', 'GAMP 5 (computerised systems)'],
    keyRisks: [
      'MHRA/FDA Warning Letter from data integrity failures (ALCOA+ principles not met)',
      'Batch recall from undetected OOS root cause due to inadequate investigation',
      'GMP inspection finding from training record gaps (Clause 2.9 EU GMP)',
      'Patient safety event from label mix-up or batch record error reaching distribution',
    ],
    industryBenchmarkSource: 'MHRA GMP Data Integrity Guidance 2021; PDA TR60 2023; APQC PCF Pharma 2024; ICH Q10 Quality System',
  },

  'Telecommunications': {
    industry: 'Telecommunications',
    benchmarks: {
      typicalProcessCycleDays: { best: 1, median: 6, worst: 28 },
      optimalHandoffsPerProcess: 4,
      automationMaturity: 'high',
      avgReworkRate: '8-14%',
    },
    commonWastePatterns: [
      'Order fallout management: 15-25% of service orders falling out of automated provisioning requiring manual intervention, with each fallout taking 2-4h to diagnose and re-process (TM Forum)',
      'Network fault triage via NOC: first-line operators manually correlating alarms across multiple EMS/NMS systems before escalation, adding 15-45 min to mean time to detect (MTTD)',
      'Billing mediation errors: usage data records failing mediation and queuing for manual correction, with 1-3% of records requiring intervention and associated revenue leakage',
      'Port porting (number portability) manual steps: inter-carrier porting process including manual LOA handling, adding 3-5 days to switch for customers beyond regulatory 1-day target',
      'Customer activation backlog: new service activation relying on manual field engineer scheduling with 5-10 day wait vs same-day for automated fibre activation',
      'Regulatory reporting preparation: manual extraction and formatting of KPI data for Ofcom reporting consuming 20-40h per report when automated extract would take <1h',
    ],
    regulatoryContext: 'Ofcom General Conditions of Entitlement (GC), Electronic Communications Act 2003, Number portability rules (GC18), Network & Information Systems (NIS) Regulations 2018 / NIS2 (EU), GDPR (customer data), Lawful Business Practice Regulations (RIPA), Telecommunications Security Act 2021 (TSAct).',
    automationOpportunities: [
      'OSS/BSS integration for zero-touch provisioning on standard service orders, reducing order fallout from 20% to <5%',
      'AIOps for proactive network anomaly detection, shifting fault identification from reactive alarm response to predictive, reducing MTTR by 40-60%',
      'Automated billing mediation with ML-based error classification and auto-correction for defined error types',
      'Digital porting hub with automated LOA processing and carrier-to-carrier API integration achieving 24h porting (Ofcom target compliance)',
    ],
    recommendedFrameworks: ['TM Forum eTOM (Frameworx)', 'ITIL 4', 'ISO/IEC 27001', 'TM Forum ODA (Open Digital Architecture)', 'Ofcom Network KPI Standards'],
    keyRisks: [
      'Ofcom enforcement from persistent number portability failures (GC18) or customer complaint volume breaches',
      'Telecommunications Security Act non-compliance creating regulatory and reputational exposure',
      'Revenue leakage from billing mediation failures undetected over quarterly reporting cycles',
      'Network resilience incident from manual NOC processes failing during high-alarm-volume events',
    ],
    industryBenchmarkSource: 'TM Forum Industry Benchmark 2024; Ofcom Connected Nations Report 2024; Gartner Telecom IT Research 2024; APQC PCF Telecom',
  },
};

/**
 * Returns comprehensive industry knowledge for a given industry name.
 * Falls back to Professional Services if industry not found.
 */
export function getIndustryKnowledge(industry) {
  const key = normalizeIndustry(industry);
  return INDUSTRY_DATA[key] || INDUSTRY_DATA['Professional Services'];
}

/**
 * Full list of supported industry names.
 */
export const INDUSTRY_LIST = Object.keys(INDUSTRY_DATA);

/**
 * Fuzzy-matches a free-text industry string to one of the 18 supported keys.
 * Matching priority: exact (case-insensitive) → partial word → best token overlap.
 */
export function normalizeIndustry(industry) {
  if (!industry) return 'Professional Services';
  const input = industry.toLowerCase().trim();

  // Exact match
  const exact = INDUSTRY_LIST.find(k => k.toLowerCase() === input);
  if (exact) return exact;

  // Alias shortcuts
  const ALIASES = {
    tech: 'Technology & Software',
    technology: 'Technology & Software',
    software: 'Technology & Software',
    saas: 'Technology & Software',
    it: 'Technology & Software',
    finance: 'Financial Services & Banking',
    financial: 'Financial Services & Banking',
    banking: 'Financial Services & Banking',
    fintech: 'Financial Services & Banking',
    health: 'Healthcare & Life Sciences',
    healthcare: 'Healthcare & Life Sciences',
    medical: 'Healthcare & Life Sciences',
    nhs: 'Healthcare & Life Sciences',
    pharma: 'Pharmaceuticals & Biotech',
    pharmaceutical: 'Pharmaceuticals & Biotech',
    biotech: 'Pharmaceuticals & Biotech',
    manufacturing: 'Manufacturing & Engineering',
    engineering: 'Manufacturing & Engineering',
    retail: 'Retail & E-commerce',
    ecommerce: 'Retail & E-commerce',
    'e-commerce': 'Retail & E-commerce',
    consulting: 'Professional Services',
    consultancy: 'Professional Services',
    accountancy: 'Professional Services',
    accountant: 'Professional Services',
    government: 'Government & Public Sector',
    'public sector': 'Government & Public Sector',
    council: 'Government & Public Sector',
    charity: 'Non-profit & Charities',
    nonprofit: 'Non-profit & Charities',
    'non-profit': 'Non-profit & Charities',
    construction: 'Construction & Real Estate',
    'real estate': 'Construction & Real Estate',
    property: 'Construction & Real Estate',
    logistics: 'Logistics & Supply Chain',
    'supply chain': 'Logistics & Supply Chain',
    transport: 'Logistics & Supply Chain',
    education: 'Education & Training',
    training: 'Education & Training',
    school: 'Education & Training',
    university: 'Education & Training',
    legal: 'Legal & Compliance',
    law: 'Legal & Compliance',
    solicitor: 'Legal & Compliance',
    hospitality: 'Hospitality & Travel',
    travel: 'Hospitality & Travel',
    hotel: 'Hospitality & Travel',
    tourism: 'Hospitality & Travel',
    energy: 'Energy & Utilities',
    utilities: 'Energy & Utilities',
    utility: 'Energy & Utilities',
    media: 'Media & Marketing',
    marketing: 'Media & Marketing',
    advertising: 'Media & Marketing',
    insurance: 'Insurance',
    telecom: 'Telecommunications',
    telecoms: 'Telecommunications',
    telecommunications: 'Telecommunications',
    telco: 'Telecommunications',
  };

  const aliasMatch = ALIASES[input];
  if (aliasMatch) return aliasMatch;

  // Partial contains match against industry keys
  const partial = INDUSTRY_LIST.find(k => k.toLowerCase().includes(input) || input.includes(k.toLowerCase().split(' ')[0]));
  if (partial) return partial;

  // Token overlap score
  const inputTokens = input.split(/[\s&,/]+/).filter(t => t.length > 2);
  let bestScore = 0;
  let bestMatch = 'Professional Services';
  for (const key of INDUSTRY_LIST) {
    const keyTokens = key.toLowerCase().split(/[\s&,/]+/);
    const overlap = inputTokens.filter(t => keyTokens.some(kt => kt.includes(t) || t.includes(kt))).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatch = key;
    }
  }
  return bestScore > 0 ? bestMatch : 'Professional Services';
}
