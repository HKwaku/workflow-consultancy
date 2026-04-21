/* Anthropic SDK tool definitions for the redesign chat agent. */

import {
  ADD_STEP_TOOL,
  UPDATE_STEP_TOOL,
  REMOVE_STEP_TOOL,
  SET_HANDOFF_TOOL,
  REPLACE_ALL_STEPS_TOOL,
} from '../chat/tools.js';

export const PROPOSE_CHANGE_TOOL = {
  name: 'propose_change',
  description:
    'Present a specific process improvement proposal to the user for review. ' +
    'Call this BEFORE making any canvas edits. The user must confirm before you apply changes.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the change, e.g. "Remove duplicate approval step"' },
      rationale: {
        type: 'string',
        description: 'Why this change improves the process. Be specific: cite the step name, the problem it causes, and the expected saving.',
      },
      steps_affected: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of steps that will be changed, added, or removed',
      },
      expected_impact: {
        type: 'string',
        description: 'Quantified or concrete outcome: time saved, cost reduction, reliability improvement',
      },
    },
    required: ['title', 'rationale'],
  },
};

export const ASK_DISCOVERY_TOOL = {
  name: 'ask_discovery',
  description:
    'Ask the user a single focused discovery question to gather context before making a proposal. ' +
    'Use when you need to understand goals, constraints, or pain points better.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'A single, specific question. Max 20 words.' },
      area: {
        type: 'string',
        enum: ['goal', 'bottleneck', 'cost', 'handoff', 'automation', 'constraint', 'outcome'],
        description: 'What area of the process this question is exploring',
      },
    },
    required: ['question', 'area'],
  },
};

export const ALL_REDESIGN_CHAT_TOOLS = [
  PROPOSE_CHANGE_TOOL,
  ASK_DISCOVERY_TOOL,
  ADD_STEP_TOOL,
  UPDATE_STEP_TOOL,
  REMOVE_STEP_TOOL,
  SET_HANDOFF_TOOL,
  REPLACE_ALL_STEPS_TOOL,
];
