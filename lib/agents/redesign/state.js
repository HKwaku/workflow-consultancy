import { Annotation } from '@langchain/langgraph';

const replace = (_, v) => v;

export const RedesignState = Annotation.Root({
  messages: Annotation({
    reducer: (left, right) => {
      const incoming = Array.isArray(right) ? right : [right];
      return [...left, ...incoming];
    },
    default: () => [],
  }),

  diagnosticData: Annotation({ reducer: replace, default: () => ({}) }),
  optimisedProcesses: Annotation({ reducer: replace, default: () => [] }),
  changes: Annotation({ reducer: replace, default: () => [] }),
  costSummary: Annotation({ reducer: replace, default: () => null }),
  executiveSummary: Annotation({ reducer: replace, default: () => '' }),
  implementationPriority: Annotation({ reducer: replace, default: () => [] }),
  validationErrors: Annotation({ reducer: replace, default: () => [] }),
  retryCount: Annotation({ reducer: replace, default: () => 0 }),
});
