export function lines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function issueSummary(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return 'Review the highlighted fields.';
  const field = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  return `${field}${first.message}`;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Enter valid JSON.');
  }
}
