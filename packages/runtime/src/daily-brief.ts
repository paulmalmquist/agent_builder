import {
  dailyBriefInputSchema,
  dailyBriefOutputSchema,
  type DailyBriefInput,
  type DailyBriefOutput,
} from '@agent-builder/contracts';

export function dailyBriefCitationAllowlist(inputValue: DailyBriefInput): ReadonlySet<string> {
  const input = dailyBriefInputSchema.parse(inputValue);
  return new Set(input.calendarItems.map((item) => `calendar:${item.startsAt}`));
}

export function invalidDailyBriefCitations(
  inputValue: DailyBriefInput,
  outputValue: DailyBriefOutput,
): string[] {
  const input = dailyBriefInputSchema.parse(inputValue);
  const output = dailyBriefOutputSchema.parse(outputValue);
  const allowed = dailyBriefCitationAllowlist(input);
  return output.citations.filter((citation) => !allowed.has(citation));
}

export function scoreDailyBriefQuality(
  inputValue: DailyBriefInput,
  outputValue: DailyBriefOutput,
): number {
  const input = dailyBriefInputSchema.parse(inputValue);
  const output = dailyBriefOutputSchema.parse(outputValue);
  if (invalidDailyBriefCitations(input, output).length > 0) return 0;
  const checks = [
    input.priorities.length === 0 || output.topPriorities.length > 0,
    input.tasks.length === 0 || output.proposedActions.length > 0,
    input.signals.length === 0 || output.decisionsRequired.length > 0,
    input.calendarItems.length === 0 || output.citations.length > 0,
  ];
  const coverage = checks.filter(Boolean).length / checks.length;
  const unresolvedPenalty = output.unresolvedItems.length === 0 ? 1 : 0.9;
  return coverage * unresolvedPenalty;
}
