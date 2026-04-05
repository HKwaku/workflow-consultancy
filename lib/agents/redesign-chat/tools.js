import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { addStepTool, updateStepTool, removeStepTool, setHandoffTool, replaceAllStepsTool } from '../chat/tools.js';

/**
 * propose_change — surfaces a structured proposal in the chat WITHOUT touching the canvas.
 * The agent calls this to present a change for the user to review.
 * Canvas tools are called in a follow-up turn only after the user confirms.
 */
export const proposeChangeTool = tool(
  async (input) => {
    const lines = [`**${input.title}**`, '', input.rationale];
    if (input.steps_affected?.length) {
      lines.push('', `Steps affected: ${input.steps_affected.join(', ')}`);
    }
    if (input.expected_impact) {
      lines.push(`Expected impact: ${input.expected_impact}`);
    }
    return lines.join('\n');
  },
  {
    name: 'propose_change',
    description:
      'Present a specific process improvement proposal to the user for review. ' +
      'Call this BEFORE making any canvas edits. The user must confirm before you apply changes.',
    schema: z.object({
      title: z.string().describe('Short title for the change, e.g. "Remove duplicate approval step"'),
      rationale: z.string().describe(
        'Why this change improves the process. Be specific: cite the step name, the problem it causes, and the expected saving.'
      ),
      steps_affected: z.array(z.string()).optional().describe('Names of steps that will be changed, added, or removed'),
      expected_impact: z.string().optional().describe('Quantified or concrete outcome: time saved, cost reduction, reliability improvement'),
    }),
  }
);

/**
 * ask_discovery — prompts the user with a focused question to gather context before proposing.
 * Use this when you need more information to make a good recommendation.
 */
export const askDiscoveryTool = tool(
  async (input) => input.question,
  {
    name: 'ask_discovery',
    description:
      'Ask the user a single focused discovery question to gather context before making a proposal. ' +
      'Use when you need to understand goals, constraints, or pain points better.',
    schema: z.object({
      question: z.string().describe('A single, specific question. Max 20 words.'),
      area: z.enum(['goal', 'bottleneck', 'cost', 'handoff', 'automation', 'constraint', 'outcome'])
        .describe('What area of the process this question is exploring'),
    }),
  }
);

export const ALL_REDESIGN_CHAT_TOOLS = [
  proposeChangeTool,
  askDiscoveryTool,
  addStepTool,
  updateStepTool,
  removeStepTool,
  setHandoffTool,
  replaceAllStepsTool,
];
