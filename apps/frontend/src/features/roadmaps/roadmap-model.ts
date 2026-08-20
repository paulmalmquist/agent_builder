import type { RoadmapProgram } from '@agent-builder/contracts';

export function isRoadmapForkFilter(
  program: RoadmapProgram,
  value: string | null,
): value is string {
  return value === 'all' || program.forks.some((fork) => fork.id === value);
}

export function filteredRoadmapForks(program: RoadmapProgram, selected: string) {
  return selected === 'all' ? program.forks : program.forks.filter((fork) => fork.id === selected);
}

export function timelinePosition(
  program: RoadmapProgram,
  startAt: string,
  endAt: string,
): { readonly startPercent: number; readonly widthPercent: number } {
  const timelineStart = Date.parse(program.timeline.startAt);
  const timelineEnd = Date.parse(program.timeline.endAt);
  const duration = Math.max(1, timelineEnd - timelineStart);
  const startPercent = ((Date.parse(startAt) - timelineStart) / duration) * 100;
  const widthPercent = ((Date.parse(endAt) - Date.parse(startAt)) / duration) * 100;
  return { startPercent, widthPercent };
}
