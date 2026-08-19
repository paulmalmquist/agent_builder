import type { ReactNode } from 'react';

export type WorkflowDraftingMarkName =
  | 'definition-sheet'
  | 'source-table'
  | 'control-flow'
  | 'acceptance-gate';

const markPaths: Record<WorkflowDraftingMarkName, ReactNode> = {
  'definition-sheet': (
    <>
      <path d="M12 8h20l6 6v26H12z" />
      <path d="M32 8v6h6M17 21h16M17 27h16M17 33h10" />
      <path d="M7 13V7h6M35 7h6v6M41 35v6h-6M13 41H7v-6" />
    </>
  ),
  'source-table': (
    <>
      <rect height="28" rx="1" width="34" x="7" y="10" />
      <path d="M7 18h34M7 27h34M18 10v28M31 10v28" />
      <path d="M3 18h4M41 27h4" />
      <circle cx="3" cy="18" r="1.5" />
      <circle cx="45" cy="27" r="1.5" />
    </>
  ),
  'control-flow': (
    <>
      <rect height="9" rx="1" width="14" x="4" y="19.5" />
      <path d="m29 13 10 11-10 11-10-11z" />
      <path d="M18 24h1M39 24h5M44 24v12h-7" />
      <path d="m34 33 3 3-3 3" />
      <circle cx="9" cy="24" r="1.5" />
    </>
  ),
  'acceptance-gate': (
    <>
      <path d="M9 9v30M39 9v30M6 13h6M36 13h6M6 35h6M36 35h6" />
      <path d="M15 31V18l7 7 11-12" />
      <path d="m27 32 4 4 9-10" />
      <path d="M15 42h18M15 39v6M33 39v6" />
    </>
  ),
};

export function WorkflowDraftingMark({ name }: { name: WorkflowDraftingMarkName }) {
  return (
    <svg
      aria-hidden="true"
      data-workflow-mark={name}
      fill="none"
      height="48"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 48 48"
      width="48"
    >
      {markPaths[name]}
    </svg>
  );
}
