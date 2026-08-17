import { z } from 'zod';

export const consoleCopyActionSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    consequence: z.string().trim().min(1).max(500),
    undo: z.string().trim().min(1).max(500),
  })
  .strict();

export const consoleCopyArtifactSchema = z
  .object({
    screen: z.string().trim().min(1).max(120),
    introduction: z.array(z.string().trim().min(1).max(500)).min(2).max(4),
    actions: z.array(consoleCopyActionSchema).max(20),
    body: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict();

export const consoleCopyArtifactListSchema = z.array(consoleCopyArtifactSchema).min(1).max(100);

export type ConsoleCopyAction = z.infer<typeof consoleCopyActionSchema>;
export type ConsoleCopyArtifact = z.infer<typeof consoleCopyArtifactSchema>;

/** Exact consequential action copy shared by server projections and live dialogs. */
export const consoleActionCopy = {
  approveRun: {
    label: 'Approve authority',
    consequence: 'Allows matching runs until this exact grant expires.',
    undo: 'Revoke the grant anytime to stop later runs.',
  },
  rejectRun: {
    label: 'Reject request',
    consequence: 'Cancels this run and records your reason.',
    undo: 'Create a new request if the limits change.',
  },
  promoteRelease: {
    label: 'Promote release',
    consequence: 'Moves the production pointer to this exact release digest.',
    undo: 'Restore the previous certified release with one governed rollback.',
  },
  declineRelease: {
    label: 'Decline release',
    consequence: 'Keeps production unchanged and records your reason permanently.',
    undo: 'Evaluate a successor release before making another promotion decision.',
  },
  acceptMemory: {
    label: 'Accept memory',
    consequence: 'Stores this reviewed value with its source and provenance.',
    undo: 'A later reviewed memory can replace the accepted value.',
  },
  rejectMemory: {
    label: 'Reject memory',
    consequence: 'Discards this proposal and leaves existing memory unchanged.',
    undo: 'Stage a new candidate from a later run.',
  },
  incubateCandidate: {
    label: 'Move to incubator',
    consequence: 'Starts governed exploration without applying or committing a patch.',
    undo: 'Reject the candidate before any repository import.',
  },
  rejectCandidate: {
    label: 'Reject candidate',
    consequence: 'Closes this proposal while retaining its observation as evidence.',
    undo: 'Create a new candidate from the retained observation.',
  },
  reviewFlightRecorder: {
    label: 'Review flight recorder',
    consequence: 'Shows phases, timing, cost, and the final recorded error.',
    undo: 'Opening the recorder is read-only and changes nothing.',
  },
  acknowledgeFailure: {
    label: 'Acknowledge failure',
    consequence: 'Removes this terminal item from Attention after review.',
    undo: 'The acknowledgement remains permanently in the audit ledger.',
  },
} as const satisfies Record<string, ConsoleCopyAction>;

/**
 * Canonical copy rendered by consequential console surfaces.
 *
 * The governed Reference JSON is a generated projection of this value. UI code imports these
 * exact strings, while release checks assert that the tracked projection remains byte-for-value
 * equivalent. This prevents a hand-maintained evaluation fixture from drifting away from the UI.
 */
export const consoleCriticalCopy = {
  home: {
    screen: 'home',
    introduction: [
      'Paul OS is the control room for governed agent work.',
      'Build, run, prove, and improve reusable capabilities without losing authority or provenance.',
    ],
    actions: [
      {
        label: 'Open Attention',
        consequence: 'Opens the governed queue for decisions and degraded work.',
        undo: 'Return home without changing any item.',
      },
      {
        label: 'Build or reuse',
        consequence: 'Checks certified matches before starting a new agent draft.',
        undo: 'Leave before saving to keep the platform unchanged.',
      },
      {
        label: 'Open registry',
        consequence: 'Shows versioned resources, Plugins, and current operational health.',
        undo: 'Browsing the registry changes nothing.',
      },
      {
        label: 'Review runs',
        consequence: 'Shows approvals, authority grants, schedules, and run recorders.',
        undo: 'Reviewing operational history changes nothing.',
      },
      {
        label: 'Review evidence',
        consequence: 'Shows outcomes, metrics, citations, and release comparisons.',
        undo: 'Reviewing evidence changes nothing.',
      },
      {
        label: 'Open incubator',
        consequence: 'Shows observations, proposed improvements, and staged memories.',
        undo: 'Nothing changes until you make a governed decision.',
      },
      {
        label: 'Open capability map',
        consequence: 'Opens the offline synthetic manufacturing capability map.',
        undo: 'Close the map without changing governed data.',
      },
    ],
    body: [
      'Attention is the only place that interrupts you.',
      'Daily Briefing carries informational activity without a badge.',
    ],
  },
  attention: {
    screen: 'attention',
    introduction: [
      'Review the few items that need you.',
      'Everything else waits for your next briefing.',
    ],
    actions: [
      {
        label: 'Why am I seeing this?',
        consequence: 'Opens provenance and exact evidence without changing anything.',
        undo: 'Close the review to leave the decision unchanged.',
      },
    ],
  },
  allQuiet: {
    screen: 'all-quiet',
    introduction: [
      'Nothing needs a decision.',
      'Paul OS shows the last successful briefing time below.',
    ],
    actions: [],
  },
  runApproval: {
    screen: 'run-approval',
    introduction: [
      'A run asks to work within exact limits.',
      'Review its sources, limits, and budget before granting authority.',
    ],
    actions: [consoleActionCopy.approveRun, consoleActionCopy.rejectRun],
    body: ['The exact granted scopes and limits appear below.'],
  },
  promotion: {
    screen: 'promotion',
    introduction: [
      'This release passed every required evidence check.',
      'Promote it to use this version for new production runs.',
    ],
    actions: [consoleActionCopy.promoteRelease, consoleActionCopy.declineRelease],
  },
  memoryReview: {
    screen: 'memory-review',
    introduction: [
      'A run proposed a durable memory.',
      'Review the exact value and its source before storing it.',
    ],
    actions: [consoleActionCopy.acceptMemory, consoleActionCopy.rejectMemory],
  },
  improvementReview: {
    screen: 'improvement-review',
    introduction: [
      'A repeated signal became a candidate improvement.',
      'Choose whether to explore it without changing the repository.',
    ],
    actions: [consoleActionCopy.incubateCandidate, consoleActionCopy.rejectCandidate],
  },
  failedRun: {
    screen: 'failed-run',
    introduction: [
      'A run stopped before producing an outcome.',
      'Review its recorder before acknowledging the terminal failure.',
    ],
    actions: [consoleActionCopy.reviewFlightRecorder, consoleActionCopy.acknowledgeFailure],
  },
  flightRecorder: {
    screen: 'flight-recorder',
    introduction: [
      'This timeline shows what the run did.',
      'Review each phase, its duration, and its recorded cost.',
    ],
    actions: [
      {
        label: 'Close detail',
        consequence: 'Returns to Attention without changing the run.',
        undo: 'Open the same item to review the timeline again.',
      },
    ],
  },
  waitingForUser: {
    screen: 'waiting-for-user',
    introduction: [
      'This run needs a tool on your approved workstation.',
      'Sign in before expiry or Paul OS cancels the run.',
    ],
    actions: [
      {
        label: 'Review requirement',
        consequence: 'Shows the required device, user, plugin, and expiry.',
        undo: 'Close the review to keep the run waiting.',
      },
    ],
    body: ['The platform never moves local work to the control plane silently.'],
  },
} as const satisfies Record<string, ConsoleCopyArtifact>;

export const consoleCriticalCopyArtifacts: readonly ConsoleCopyArtifact[] = [
  consoleCriticalCopy.home,
  consoleCriticalCopy.attention,
  consoleCriticalCopy.allQuiet,
  consoleCriticalCopy.runApproval,
  consoleCriticalCopy.promotion,
  consoleCriticalCopy.memoryReview,
  consoleCriticalCopy.improvementReview,
  consoleCriticalCopy.failedRun,
  consoleCriticalCopy.flightRecorder,
  consoleCriticalCopy.waitingForUser,
];
