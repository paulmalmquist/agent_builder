import type {
  InterpretationPrefillResponse,
  InterpretationResolution,
} from '@agent-builder/contracts';

export type InterpretationUnresolvedItem =
  InterpretationPrefillResponse['sections'][keyof InterpretationPrefillResponse['sections']]['unresolved'][number];

export type InterpretationResolutionById = Partial<Record<string, InterpretationResolution>>;

export type InterpretationResolutionChange = (
  itemId: string,
  resolution: InterpretationResolution | null,
) => void;

export function hasUnresolvedAnswers(
  items: InterpretationUnresolvedItem[],
  resolutions: InterpretationResolutionById,
) {
  return items.every((item) => {
    const resolution = resolutions[item.id];
    if (!resolution || resolution.unresolvedId !== item.id) return false;
    if (resolution.action === 'acknowledge') {
      return resolution.rationale.trim().length >= 3;
    }
    return true;
  });
}
