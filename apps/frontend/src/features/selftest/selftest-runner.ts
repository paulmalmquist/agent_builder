import {
  SELFTEST_SCHEMA_VERSION,
  selfTestReportSchema,
  summarizeSelfTestResults,
  type SelfTestReport,
  type SelfTestResult,
  type SelfTestStatus,
} from '@agent-builder/contracts';

export const SELFTEST_WIDTHS = [390, 768, 1440] as const;

export const SELFTEST_HEIGHT_BY_WIDTH: Readonly<Record<(typeof SELFTEST_WIDTHS)[number], number>> =
  {
    390: 844,
    768: 1024,
    1440: 900,
  };

interface AssertionDefinition {
  description: string;
  expected: string;
  id: string;
  route: string;
}

export const SELFTEST_ASSERTIONS: readonly AssertionDefinition[] = [
  {
    id: 'viewport.achieved',
    description: 'The iframe exposes the exact requested CSS viewport.',
    expected: 'iframe innerWidth and innerHeight equal the requested matrix dimensions.',
    route: '/selftest',
  },
  {
    id: 'kpi.count.all',
    description: 'All scope renders exactly eight KPI cards.',
    expected: '8 rendered KPI cards in All scope.',
    route: '/',
  },
  {
    id: 'kpi.count.scoped',
    description: 'Every rendered program vertical scopes health to four metrics.',
    expected: '4 rendered KPI cards for every program vertical exposed by the live DOM.',
    route: '/',
  },
  {
    id: 'kpi.footer.nooverlap',
    description: 'KPI status text and its inspect affordance do not collide.',
    expected: 'Zero bounding-rectangle intersection in All and every vertical scope.',
    route: '/',
  },
  {
    id: 'kpi.ariapressed',
    description: 'Metric trace selection is programmatically exposed.',
    expected: 'All metric buttons are false with no trace; exactly one is true with a trace open.',
    route: '/',
  },
  {
    id: 'kpi.activate.pointer',
    description: 'The Factory KPI scopes state, plan, and action through its pointer path.',
    expected: 'vertical=group_factory and metric=vertical-coverage:group_factory in one URL.',
    route: '/',
  },
  {
    id: 'kpi.activate.keyboard',
    description: 'Enter and Space activate a focused KPI through the same route.',
    expected: 'Both keys produce the same Factory URL as the pointer path.',
    route: '/',
  },
  {
    id: 'kpi.focus.transfer',
    description: 'Focus survives when the activated roll-up KPI unmounts.',
    expected: 'The Factory vertical chip owns focus after scope activation, never body.',
    route: '/',
  },
  {
    id: 'nav.back.onestep',
    description: 'One browser Back restores the complete All state.',
    expected:
      'All, 8 KPIs, the baseline plan, global actions, and digest metrics return in one step.',
    route: '/',
  },
  {
    id: 'plan.list.persists',
    description: 'Dated List mode survives scope and browser history navigation.',
    expected: 'plan=list remains set through scope, Back, and Forward.',
    route: '/?plan=list',
  },
  {
    id: 'metric.incompatible.cleared',
    description: 'Changing vertical clears an incompatible open metric trace.',
    expected: 'The new vertical remains and the metric query parameter is absent.',
    route: '/?vertical=group_factory&metric=vertical-coverage%3Agroup_factory',
  },
  {
    id: 'metric.global.noscope',
    description: 'A global digest metric opens without inventing a vertical scope.',
    expected: 'metric=digest-runs is present and vertical is absent.',
    route: '/',
  },
  {
    id: 'url.restore.notransient',
    description: 'A direct scoped load never flashes an All selection.',
    expected: 'Every observed selected chip from first render through 1.5 seconds is Factory.',
    route: '/?vertical=group_factory&metric=vertical-coverage%3Agroup_factory',
  },
  {
    id: 'truth.nozero',
    description: 'Missing readings never masquerade as zero or nominal.',
    expected: 'PENDING, UNAVAILABLE, and AWAITING TRANSFER cards render — and no nominal label.',
    route: '/',
  },
  {
    id: 'truth.badges',
    description: 'Every displayed KPI value declares one source state.',
    expected: 'Exactly one allowed source badge appears on every KPI card in every scope.',
    route: '/',
  },
  {
    id: 'a11y.hittarget',
    description: 'Required Home controls have usable pointer targets.',
    expected:
      'KPI buttons, vertical chips, plan links, plan toggles, and open detail controls are at least 44×44 CSS px.',
    route: '/',
  },
  {
    id: 'a11y.focusvisible',
    description: 'Required Home controls expose a visible keyboard focus indicator.',
    expected:
      'Every script-focused required Home control matches :focus-visible with a visible outline.',
    route: '/',
  },
  {
    id: 'layout.nooverflow',
    description: 'Home keeps horizontal scrolling inside the Gantt viewport.',
    expected: 'The document has no horizontal overflow; narrow Gantt overflow remains internal.',
    route: '/',
  },
  {
    id: 'gantt.pointer.activates',
    description: 'A Gantt row follows its declared destination on pointer activation.',
    expected: 'Synthetic pointer activation navigates to the row anchor href.',
    route: '/',
  },
  {
    id: 'search.enter.activates',
    description: 'Enter opens the highlighted governed search result.',
    expected: 'The selected option destination becomes the iframe URL.',
    route: '/',
  },
] as const;

const definitionById = new Map(
  SELFTEST_ASSERTIONS.map((definition) => [definition.id, definition]),
);
const allowedSourceLabels = new Set([
  'LIVE',
  'SYNTHETIC',
  'AWAITING TRANSFER',
  'PENDING',
  'UNAVAILABLE',
]);
const missingSourceStates = new Set(['awaiting_transfer', 'pending', 'unavailable']);
const nominalStatusPattern = /\b(?:covered|current(?:ly)? certified|on track|within policy)\b/iu;
const factoryRollupTestId = 'home-metric-coverage:group_factory';
const factoryVerticalTestId = 'home-vertical-group_factory';
const structuresVerticalTestId = 'home-vertical-group_structures';
const factoryMetricId = 'vertical-coverage:group_factory';

interface FrameContext {
  document: Document;
  frame: HTMLIFrameElement;
  height: number;
  width: number;
  window: Window;
}

interface HomeScan {
  badgeCards: number;
  badgeProblems: string[];
  footerPairs: number;
  footerProblems: string[];
  missingCards: number;
  truthProblems: string[];
}

interface HomeSnapshot {
  actionKeys: string[];
  digestIds: string[];
  hasAttention: boolean;
  metricIds: string[];
  workstreamIds: string[];
}

interface ControlScan {
  focusFailures: string[];
  focusMeasurable: number;
  hitFailures: string[];
  total: number;
}

interface LayoutScan {
  documentOverflow: number;
  ganttClientWidth: number | null;
  ganttOverflowX: string | null;
  ganttScrollWidth: number | null;
  route: string;
}

export interface SelfTestRunnerOptions {
  commit: string | null;
  frame: HTMLIFrameElement;
  signal: AbortSignal;
  widths: readonly number[];
  onResult?: (result: SelfTestResult) => void;
}

function assertionResult(
  id: string,
  width: number,
  status: SelfTestStatus,
  actual: string,
  overrides: Partial<Pick<SelfTestResult, 'expected' | 'route'>> = {},
): SelfTestResult {
  const definition = definitionById.get(id);
  if (!definition) throw new Error(`Unknown self-test assertion: ${id}`);
  return {
    id,
    width,
    status,
    description: definition.description,
    expected: overrides.expected ?? definition.expected,
    actual,
    route: overrides.route ?? definition.route,
  };
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function compactLabel(element: Element): string {
  return normalizeText(element.getAttribute('aria-label') ?? element.textContent).slice(0, 120);
}

function stableRoute(location: Location): string {
  return `${location.pathname}${location.search}`;
}

function sortedQuery(location: Location): string {
  return [...new URLSearchParams(location.search).entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function abortError(): DOMException {
  return new DOMException('Self-test run was cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      window.clearTimeout(timer);
      reject(abortError());
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitUntil<T>(
  read: () => T | null | false | undefined,
  signal: AbortSignal,
  timeoutMs = 12_000,
): Promise<T> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    throwIfAborted(signal);
    try {
      const value = read();
      if (value) return value;
    } catch {
      // A navigation can replace the iframe document between two property reads.
    }
    await wait(25, signal);
  }
  throw new Error('Timed out waiting for the rendered application state.');
}

async function navigate(
  frame: HTMLIFrameElement,
  route: string,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<FrameContext> {
  if (new URL(route, window.location.origin).pathname === '/selftest') {
    throw new Error('The self-test runner cannot frame itself.');
  }
  frame.width = String(width);
  frame.height = String(height);
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;

  await new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out loading the application iframe.'));
    }, 15_000);
    function cleanup() {
      window.clearTimeout(timeout);
      frame.removeEventListener('load', onLoad);
      signal.removeEventListener('abort', onAbort);
    }
    function onLoad() {
      cleanup();
      resolve();
    }
    function onAbort() {
      cleanup();
      reject(abortError());
    }
    frame.addEventListener('load', onLoad, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    frame.src = new URL(route, window.location.origin).toString();
  });

  throwIfAborted(signal);
  const childWindow = frame.contentWindow;
  const childDocument = frame.contentDocument;
  if (!childWindow || !childDocument) {
    throw new Error('The same-origin iframe document is unavailable.');
  }
  return { document: childDocument, frame, height, width, window: childWindow };
}

async function settleHome(context: FrameContext, signal: AbortSignal): Promise<void> {
  await waitUntil(
    () =>
      context.document.querySelector('h1')?.textContent?.trim() === 'Today' &&
      context.document.querySelectorAll('.today-metric-select').length > 0,
    signal,
  );
  await waitUntil(() => {
    const hasPendingSource =
      context.document.querySelector(
        '.today-loading, .today-source-badge[data-source="pending"]',
      ) !== null;
    const hasReadingCopy = [...context.document.querySelectorAll('.today-muted')].some((element) =>
      normalizeText(element.textContent).startsWith('Reading '),
    );
    return !hasPendingSource && !hasReadingCopy;
  }, signal);
  await wait(50, signal);
}

async function waitForQuery(
  context: FrameContext,
  expected: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<void> {
  await waitUntil(() => {
    const params = new URLSearchParams(context.window.location.search);
    const entries = [...params.entries()];
    const matches =
      entries.length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => params.get(key) === value);
    return matches;
  }, signal);
}

function findRequired<T extends Element>(document: Document, selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required rendered control is absent: ${selector}`);
  return element;
}

function triggerPointer(context: FrameContext, element: HTMLElement): boolean {
  const childGlobal = context.window as unknown as typeof globalThis;
  const PointerEventConstructor = childGlobal.PointerEvent;
  if (!PointerEventConstructor) return false;
  element.dispatchEvent(
    new PointerEventConstructor('pointerdown', {
      bubbles: true,
      button: 0,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
    }),
  );
  element.dispatchEvent(
    new PointerEventConstructor('pointerup', {
      bubbles: true,
      button: 0,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
    }),
  );
  element.click();
  return true;
}

function triggerKeyboard(context: FrameContext, element: HTMLElement, key: string, code: string) {
  const childGlobal = context.window as unknown as typeof globalThis;
  element.dispatchEvent(
    new childGlobal.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code,
      key,
      repeat: false,
    }),
  );
  element.dispatchEvent(
    new childGlobal.KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      code,
      key,
      repeat: false,
    }),
  );
}

export function rectanglesOverlap(left: DOMRect, right: DOMRect): boolean {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.right, right.right) - Math.max(left.left, right.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  );
  return intersectionWidth > 0 && intersectionHeight > 0;
}

function scanHome(document: Document, route: string): HomeScan {
  const footerProblems: string[] = [];
  const badgeProblems: string[] = [];
  const truthProblems: string[] = [];
  let footerPairs = 0;
  let badgeCards = 0;
  let missingCards = 0;

  for (const card of document.querySelectorAll<HTMLElement>('.today-metric')) {
    const label = compactLabel(card);
    const status = card.querySelector<HTMLElement>('.today-metric-status');
    const inspect = card.querySelector<HTMLElement>('.today-metric-inspect-label');
    if (status && inspect) {
      footerPairs += 1;
      if (rectanglesOverlap(status.getBoundingClientRect(), inspect.getBoundingClientRect())) {
        footerProblems.push(`${route}: ${label}`);
      }
    }

    const badges = card.querySelectorAll<HTMLElement>('.today-source-badge');
    badgeCards += 1;
    if (badges.length !== 1 || !allowedSourceLabels.has(normalizeText(badges[0]?.textContent))) {
      badgeProblems.push(`${route}: ${label} (${badges.length} allowed badges)`);
    }

    const sourceState = card.dataset['source'] ?? '';
    if (missingSourceStates.has(sourceState)) {
      missingCards += 1;
      const value = normalizeText(card.querySelector('.today-metric-value strong')?.textContent);
      const statusText = normalizeText(status?.textContent);
      if (value !== '—' || nominalStatusPattern.test(statusText)) {
        truthProblems.push(
          `${route}: ${label} rendered “${value}” / “${statusText || 'no status'}”`,
        );
      }
    }
  }
  return {
    badgeCards,
    badgeProblems,
    footerPairs,
    footerProblems,
    missingCards,
    truthProblems,
  };
}

function homeSnapshot(document: Document): HomeSnapshot {
  const attributeValues = (selector: string, attribute: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)]
      .map((element) => element.getAttribute(attribute) ?? '')
      .filter(Boolean)
      .sort();
  const actionKeys = [...document.querySelectorAll<HTMLElement>('.today-task-list li a')]
    .map((element) => `${element.getAttribute('href') ?? ''}|${normalizeText(element.textContent)}`)
    .sort();
  return {
    actionKeys,
    digestIds: attributeValues('[data-testid^="home-metric-digest-"]', 'data-testid'),
    hasAttention:
      normalizeText(document.querySelector('.today-needs-you h3')?.textContent) === 'Needs you',
    metricIds: attributeValues('.today-metric', 'data-testid'),
    workstreamIds: attributeValues('[data-testid^="home-workstream-"]', 'data-testid'),
  };
}

function requiredHomeControls(document: Document): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('.today-metric-select'),
    ...document.querySelectorAll<HTMLElement>('.today-vertical-filter button'),
    ...document.querySelectorAll<HTMLElement>('.today-gantt-row-link'),
    ...document.querySelectorAll<HTMLElement>('.today-plan-view button'),
    ...document.querySelectorAll<HTMLElement>('.today-metric-detail button'),
  ];
}

function scanControls(context: FrameContext): ControlScan {
  const controls = requiredHomeControls(context.document);
  const hitFailures: string[] = [];
  const focusFailures: string[] = [];
  let focusMeasurable = 0;
  for (const control of controls) {
    const label = compactLabel(control) || control.className;
    const rect = control.getBoundingClientRect();
    if (rect.width < 43.5 || rect.height < 43.5) {
      hitFailures.push(`${label} (${rect.width.toFixed(1)}×${rect.height.toFixed(1)})`);
    }
    control.focus({ preventScroll: true });
    if (control.matches(':focus-visible')) {
      focusMeasurable += 1;
      const style = context.window.getComputedStyle(control);
      const visibleOutline =
        style.outlineStyle !== 'none' &&
        Number.parseFloat(style.outlineWidth) >= 1 &&
        style.outlineColor !== 'transparent';
      if (!visibleOutline) focusFailures.push(label);
    }
  }
  return { focusFailures, focusMeasurable, hitFailures, total: controls.length };
}

function scanLayout(context: FrameContext): LayoutScan {
  const root = context.document.documentElement;
  const gantt = context.document.querySelector<HTMLElement>('[data-testid="home-gantt-viewport"]');
  return {
    documentOverflow: root.scrollWidth - root.clientWidth,
    ganttClientWidth: gantt?.clientWidth ?? null,
    ganttOverflowX: gantt ? context.window.getComputedStyle(gantt).overflowX : null,
    ganttScrollWidth: gantt?.scrollWidth ?? null,
    route: stableRoute(context.window.location),
  };
}

async function activateFactory(context: FrameContext, signal: AbortSignal): Promise<boolean> {
  const plan = new URLSearchParams(context.window.location.search).get('plan');
  const button = findRequired<HTMLElement>(
    context.document,
    `[data-testid="${factoryRollupTestId}"] .today-metric-select`,
  );
  const pointerAvailable = triggerPointer(context, button);
  if (!pointerAvailable) return false;
  await waitForQuery(
    context,
    {
      ...(plan ? { plan } : {}),
      metric: factoryMetricId,
      vertical: 'group_factory',
    },
    signal,
  );
  await waitUntil(
    () => context.document.querySelectorAll('.today-metric-select').length === 4,
    signal,
  );
  return true;
}

function reportError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') throw error;
  return error instanceof Error ? error.message.slice(0, 300) : 'Unknown runner error.';
}

async function runColumn(
  frame: HTMLIFrameElement,
  width: number,
  height: number,
  signal: AbortSignal,
  emit: (result: SelfTestResult) => void,
): Promise<SelfTestResult[]> {
  const results = new Map<string, SelfTestResult>();
  const record = (
    id: string,
    status: SelfTestStatus,
    actual: string,
    overrides?: Partial<Pick<SelfTestResult, 'expected' | 'route'>>,
  ) => {
    const result = assertionResult(id, width, status, actual, overrides);
    results.set(id, result);
    emit(result);
  };

  let context: FrameContext;
  try {
    context = await navigate(frame, '/', width, height, signal);
  } catch (error) {
    const reason = reportError(error);
    record('viewport.achieved', 'SKIPPED', `Viewport could not be inspected: ${reason}`);
    for (const definition of SELFTEST_ASSERTIONS.slice(1)) {
      record(definition.id, 'SKIPPED', `Iframe prerequisite unavailable: ${reason}`);
    }
    return [...results.values()];
  }

  const viewportActual = `${context.window.innerWidth}×${context.window.innerHeight}`;
  if (context.window.innerWidth !== width || context.window.innerHeight !== height) {
    record(
      'viewport.achieved',
      'SKIPPED',
      `Requested ${width}×${height}; achieved ${viewportActual}. The column was not measured.`,
    );
    for (const definition of SELFTEST_ASSERTIONS.slice(1)) {
      record(
        definition.id,
        'SKIPPED',
        `Viewport prerequisite failed: requested ${width}×${height}, achieved ${viewportActual}.`,
      );
    }
    return [...results.values()];
  }
  record('viewport.achieved', 'PASS', `Measured iframe CSS viewport ${viewportActual}.`);

  try {
    await settleHome(context, signal);
  } catch (error) {
    const reason = reportError(error);
    record('kpi.count.all', 'FAIL', `Today did not reach a measurable KPI state: ${reason}`);
    for (const definition of SELFTEST_ASSERTIONS.slice(2)) {
      record(definition.id, 'SKIPPED', `Today prerequisite unavailable: ${reason}`);
    }
    return [...results.values()];
  }

  const allMetricCount = context.document.querySelectorAll('.today-metric').length;
  record(
    'kpi.count.all',
    allMetricCount === 8 ? 'PASS' : 'FAIL',
    `Rendered ${allMetricCount} KPI cards in All scope.`,
  );

  const scans: HomeScan[] = [scanHome(context.document, '/')];
  const layoutScans: LayoutScan[] = [scanLayout(context)];
  const controlScans: ControlScan[] = [scanControls(context)];
  const groupIds = [
    ...context.document.querySelectorAll<HTMLElement>('[data-testid^="home-vertical-group_"]'),
  ]
    .map((element) => element.dataset['testid']?.replace('home-vertical-', '') ?? '')
    .filter(Boolean);
  const scopedCounts: Array<{ count: number; id: string }> = [];

  for (const groupId of groupIds) {
    throwIfAborted(signal);
    const chip = findRequired<HTMLButtonElement>(
      context.document,
      `[data-testid="home-vertical-${groupId}"]`,
    );
    chip.click();
    await waitUntil(
      () =>
        chip.getAttribute('aria-pressed') === 'true' &&
        new URLSearchParams(context.window.location.search).get('vertical') === groupId,
      signal,
    );
    await wait(25, signal);
    const count = context.document.querySelectorAll('.today-metric').length;
    scopedCounts.push({ count, id: groupId });
    const route = stableRoute(context.window.location);
    scans.push(scanHome(context.document, route));
    layoutScans.push(scanLayout(context));
    controlScans.push(scanControls(context));
  }
  const badScopedCounts = scopedCounts.filter(({ count }) => count !== 4);
  record(
    'kpi.count.scoped',
    groupIds.length > 0 && badScopedCounts.length === 0 ? 'PASS' : 'FAIL',
    groupIds.length === 0
      ? 'No program vertical chips were available to exercise.'
      : `${scopedCounts.length} live vertical scopes measured; ${badScopedCounts.length} differed from 4${
          badScopedCounts.length > 0
            ? ` (${badScopedCounts.map(({ id, count }) => `${id}: ${count}`).join(', ')})`
            : ''
        }.`,
  );

  const footerPairs = scans.reduce((sum, scan) => sum + scan.footerPairs, 0);
  const footerProblems = scans.flatMap((scan) => scan.footerProblems);
  record(
    'kpi.footer.nooverlap',
    footerPairs > 0 && footerProblems.length === 0 ? 'PASS' : 'FAIL',
    footerPairs === 0
      ? 'No KPI status/affordance pairs were measurable.'
      : `${footerPairs} status/affordance pairs measured; ${footerProblems.length} overlaps${
          footerProblems.length > 0 ? `: ${footerProblems.slice(0, 4).join('; ')}` : ''
        }.`,
  );

  const badgeCards = scans.reduce((sum, scan) => sum + scan.badgeCards, 0);
  const badgeProblems = scans.flatMap((scan) => scan.badgeProblems);
  record(
    'truth.badges',
    badgeCards > 0 && badgeProblems.length === 0 ? 'PASS' : 'FAIL',
    `${badgeCards} KPI values inspected across All and ${groupIds.length} vertical scopes; ${badgeProblems.length} badge violations${
      badgeProblems.length > 0 ? `: ${badgeProblems.slice(0, 4).join('; ')}` : ''
    }.`,
  );

  const missingCards = scans.reduce((sum, scan) => sum + scan.missingCards, 0);
  const truthProblems = scans.flatMap((scan) => scan.truthProblems);
  record(
    'truth.nozero',
    truthProblems.length === 0 ? 'PASS' : 'FAIL',
    `${missingCards} missing-source KPI renderings inspected; ${truthProblems.length} zero/nominal contradictions${
      truthProblems.length > 0 ? `: ${truthProblems.slice(0, 4).join('; ')}` : ''
    }.`,
  );

  try {
    context = await navigate(frame, '/', width, height, signal);
    await settleHome(context, signal);
    const unselectedButtons = [
      ...context.document.querySelectorAll<HTMLElement>('.today-metric-select'),
    ];
    const noTraceState = unselectedButtons.every(
      (button) => button.getAttribute('aria-pressed') === 'false',
    );
    const baseline = homeSnapshot(context.document);
    const pointerAvailable = await activateFactory(context, signal);
    const pointerRoute = stableRoute(context.window.location);
    record(
      'kpi.activate.pointer',
      pointerAvailable &&
        sortedQuery(context.window.location) ===
          'metric=vertical-coverage:group_factory&vertical=group_factory'
        ? 'PASS'
        : pointerAvailable
          ? 'FAIL'
          : 'SKIPPED',
      pointerAvailable
        ? `Pointer events plus click produced ${pointerRoute}.`
        : 'PointerEvent is not exposed in this browser; no pointer result was claimed.',
    );

    const focused = context.document.activeElement;
    const focusTestId = focused?.getAttribute('data-testid');
    record(
      'kpi.focus.transfer',
      focusTestId === factoryVerticalTestId && focused !== context.document.body ? 'PASS' : 'FAIL',
      `Active element after scope change: ${focusTestId ?? focused?.tagName.toLocaleLowerCase() ?? 'none'}.`,
    );

    const selectedButtons = [
      ...context.document.querySelectorAll<HTMLElement>('.today-metric-select'),
    ];
    const selectedTrueCount = selectedButtons.filter(
      (button) => button.getAttribute('aria-pressed') === 'true',
    ).length;
    const selectedAllDeclared = selectedButtons.every((button) =>
      ['true', 'false'].includes(button.getAttribute('aria-pressed') ?? ''),
    );
    record(
      'kpi.ariapressed',
      noTraceState && selectedAllDeclared && selectedTrueCount === 1 ? 'PASS' : 'FAIL',
      `No-trace all-false=${String(noTraceState)}; open trace true count=${selectedTrueCount}; every scoped button declared=${String(selectedAllDeclared)}.`,
    );

    const scopedControlScan = scanControls(context);
    controlScans.push(scopedControlScan);
    const controlScan = controlScans.reduce<ControlScan>(
      (aggregate, scan) => ({
        focusFailures: [...aggregate.focusFailures, ...scan.focusFailures],
        focusMeasurable: aggregate.focusMeasurable + scan.focusMeasurable,
        hitFailures: [...aggregate.hitFailures, ...scan.hitFailures],
        total: aggregate.total + scan.total,
      }),
      { focusFailures: [], focusMeasurable: 0, hitFailures: [], total: 0 },
    );
    record(
      'a11y.hittarget',
      controlScan.total > 0 && controlScan.hitFailures.length === 0 ? 'PASS' : 'FAIL',
      `${controlScan.total} required Home controls measured in All, every vertical scope, and an open Factory trace; ${controlScan.hitFailures.length} below 44×44${
        controlScan.hitFailures.length > 0
          ? `: ${controlScan.hitFailures.slice(0, 6).join('; ')}`
          : ''
      }.`,
    );
    record(
      'a11y.focusvisible',
      controlScan.focusMeasurable === 0
        ? 'SKIPPED'
        : controlScan.focusMeasurable === controlScan.total &&
            controlScan.focusFailures.length === 0
          ? 'PASS'
          : 'FAIL',
      controlScan.focusMeasurable === 0
        ? 'The browser did not expose :focus-visible under script-directed focus; no PASS was claimed.'
        : `${controlScan.focusMeasurable} of ${controlScan.total} controls matched :focus-visible; ${controlScan.focusFailures.length} lacked a visible outline.`,
    );

    context.window.history.back();
    await waitForQuery(context, {}, signal);
    await waitUntil(() => context.document.querySelectorAll('.today-metric').length === 8, signal);
    const restored = homeSnapshot(context.document);
    const allChipSelected =
      context.document
        .querySelector('[data-testid="home-vertical-all"]')
        ?.getAttribute('aria-pressed') === 'true';
    const restoredInOneStep =
      allChipSelected &&
      arraysEqual(restored.metricIds, baseline.metricIds) &&
      arraysEqual(restored.workstreamIds, baseline.workstreamIds) &&
      arraysEqual(restored.actionKeys, baseline.actionKeys) &&
      arraysEqual(restored.digestIds, baseline.digestIds) &&
      restored.hasAttention;
    record(
      'nav.back.onestep',
      restoredInOneStep ? 'PASS' : 'FAIL',
      `After one Back: All=${String(allChipSelected)}, KPIs=${restored.metricIds.length}, plan rows=${restored.workstreamIds.length}/${baseline.workstreamIds.length}, actions=${restored.actionKeys.length}/${baseline.actionKeys.length}, digest metrics=${restored.digestIds.length}/${baseline.digestIds.length}, Attention=${String(restored.hasAttention)}.`,
    );
  } catch (error) {
    const reason = reportError(error);
    for (const id of [
      'kpi.activate.pointer',
      'kpi.focus.transfer',
      'kpi.ariapressed',
      'a11y.hittarget',
      'a11y.focusvisible',
      'nav.back.onestep',
    ]) {
      if (!results.has(id)) record(id, 'FAIL', `Interaction scenario did not complete: ${reason}`);
    }
  }

  try {
    const keyRoutes: string[] = [];
    const keySemantics: string[] = [];
    for (const [key, code] of [
      ['Enter', 'Enter'],
      [' ', 'Space'],
    ] as const) {
      context = await navigate(frame, '/', width, height, signal);
      await settleHome(context, signal);
      const button = findRequired<HTMLElement>(
        context.document,
        `[data-testid="${factoryRollupTestId}"] .today-metric-select`,
      );
      button.focus();
      keySemantics.push(`${button.tagName.toLocaleLowerCase()}/tabIndex=${button.tabIndex}`);
      triggerKeyboard(context, button, key, code);
      await waitForQuery(context, { metric: factoryMetricId, vertical: 'group_factory' }, signal);
      keyRoutes.push(sortedQuery(context.window.location));
    }
    const pointerQuery = 'metric=vertical-coverage:group_factory&vertical=group_factory';
    const keysMatch = keyRoutes.length === 2 && keyRoutes.every((route) => route === pointerQuery);
    const sequentialStops = keySemantics.every((value) => value === 'button/tabIndex=0');
    record(
      'kpi.activate.keyboard',
      keysMatch && sequentialStops ? 'PASS' : 'FAIL',
      `Script-dispatched Enter/Space keydown routes: ${keyRoutes.join(' | ')}; focused semantics: ${keySemantics.join(' | ')}. Events are untrusted browser events; Playwright remains the trusted-input check.`,
    );
  } catch (error) {
    record(
      'kpi.activate.keyboard',
      'FAIL',
      `Keyboard scenario did not complete: ${reportError(error)}`,
    );
  }

  try {
    context = await navigate(frame, '/?plan=list', width, height, signal);
    await settleHome(context, signal);
    await activateFactory(context, signal);
    const scopedList =
      new URLSearchParams(context.window.location.search).get('plan') === 'list' &&
      context.document.querySelector('[data-testid="home-workstream-list"]') !== null;
    context.window.history.back();
    await waitForQuery(context, { plan: 'list' }, signal);
    const backList =
      context.document.querySelector('[data-testid="home-workstream-list"]') !== null;
    context.window.history.forward();
    await waitForQuery(
      context,
      { metric: factoryMetricId, plan: 'list', vertical: 'group_factory' },
      signal,
    );
    const forwardList =
      context.document.querySelector('[data-testid="home-workstream-list"]') !== null;
    record(
      'plan.list.persists',
      scopedList && backList && forwardList ? 'PASS' : 'FAIL',
      `Dated List rendered after scope=${String(scopedList)}, Back=${String(backList)}, Forward=${String(forwardList)}.`,
    );
  } catch (error) {
    record(
      'plan.list.persists',
      'FAIL',
      `History scenario did not complete: ${reportError(error)}`,
    );
  }

  try {
    context = await navigate(
      frame,
      '/?vertical=group_factory&metric=vertical-coverage%3Agroup_factory',
      width,
      height,
      signal,
    );
    await settleHome(context, signal);
    findRequired<HTMLButtonElement>(
      context.document,
      `[data-testid="${structuresVerticalTestId}"]`,
    ).click();
    await waitForQuery(context, { vertical: 'group_structures' }, signal);
    const params = new URLSearchParams(context.window.location.search);
    record(
      'metric.incompatible.cleared',
      params.get('vertical') === 'group_structures' && !params.has('metric') ? 'PASS' : 'FAIL',
      `Gesture produced ${stableRoute(context.window.location)}.`,
    );
  } catch (error) {
    record(
      'metric.incompatible.cleared',
      'FAIL',
      `Vertical-change scenario did not complete: ${reportError(error)}`,
    );
  }

  try {
    context = await navigate(frame, '/', width, height, signal);
    await settleHome(context, signal);
    findRequired<HTMLButtonElement>(
      context.document,
      '[data-testid="home-metric-digest-runs"] .today-metric-select',
    ).click();
    await waitForQuery(context, { metric: 'digest-runs' }, signal);
    const params = new URLSearchParams(context.window.location.search);
    record(
      'metric.global.noscope',
      params.get('metric') === 'digest-runs' && !params.has('vertical') ? 'PASS' : 'FAIL',
      `Global metric gesture produced ${stableRoute(context.window.location)}.`,
    );
  } catch (error) {
    record(
      'metric.global.noscope',
      'FAIL',
      `Global-metric scenario did not complete: ${reportError(error)}`,
    );
  }

  try {
    context = await navigate(frame, '/', width, height, signal);
    await settleHome(context, signal);
    const observedSelections: string[] = [];
    const scopedRoute = '/?vertical=group_factory&metric=vertical-coverage%3Agroup_factory';
    const observationStartedAt = performance.now();
    const navigation = navigate(frame, scopedRoute, width, height, signal);
    while (performance.now() - observationStartedAt < 1_500) {
      throwIfAborted(signal);
      try {
        const childWindow = frame.contentWindow;
        const childDocument = frame.contentDocument;
        if (
          childWindow &&
          childDocument &&
          new URLSearchParams(childWindow.location.search).get('vertical') === 'group_factory'
        ) {
          const selected = childDocument.querySelector<HTMLElement>(
            '.today-vertical-filter button[aria-pressed="true"]',
          );
          if (selected)
            observedSelections.push(selected.dataset['testid'] ?? compactLabel(selected));
        }
      } catch {
        // The document is between same-origin navigations; no UI selection exists to sample yet.
      }
      await wait(10, signal);
    }
    context = await navigation;
    await settleHome(context, signal);
    const finalSelection = context.document.querySelector<HTMLElement>(
      '.today-vertical-filter button[aria-pressed="true"]',
    );
    if (finalSelection) {
      observedSelections.push(finalSelection.dataset['testid'] ?? compactLabel(finalSelection));
    }
    const transientAll = observedSelections.includes('home-vertical-all');
    const wrongSelection = observedSelections.some(
      (selection) => selection !== factoryVerticalTestId,
    );
    record(
      'url.restore.notransient',
      observedSelections.length > 0 && !transientAll && !wrongSelection ? 'PASS' : 'FAIL',
      `${observedSelections.length} rendered selection samples; All observed=${String(transientAll)}; unexpected selection=${String(wrongSelection)}. Sampling began before navigation and continued for 1.5 seconds.`,
    );
  } catch (error) {
    record(
      'url.restore.notransient',
      'FAIL',
      `Scoped-load observation did not complete: ${reportError(error)}`,
    );
  }

  try {
    context = await navigate(frame, '/', width, height, signal);
    await settleHome(context, signal);
    const row = findRequired<HTMLAnchorElement>(context.document, '.today-gantt-row-link');
    const href = new URL(row.href, context.window.location.origin);
    const pointerAvailable = triggerPointer(context, row);
    if (!pointerAvailable) {
      record(
        'gantt.pointer.activates',
        'SKIPPED',
        'PointerEvent is not exposed in this browser; no Gantt activation PASS was claimed.',
      );
    } else {
      await waitUntil(
        () =>
          context.window.location.pathname === href.pathname &&
          context.window.location.search === href.search,
        signal,
      );
      record(
        'gantt.pointer.activates',
        'PASS',
        `Synthetic pointer events plus click navigated to ${stableRoute(context.window.location)}, matching the anchor href.`,
      );
    }
  } catch (error) {
    record(
      'gantt.pointer.activates',
      'FAIL',
      `Gantt pointer scenario did not complete: ${reportError(error)}`,
    );
  }

  try {
    context = await navigate(frame, '/', width, height, signal);
    await settleHome(context, signal);
    const trigger = findRequired<HTMLButtonElement>(
      context.document,
      'button[aria-label="Search governed entities"]',
    );
    trigger.click();
    const input = await waitUntil(
      () =>
        context.document.querySelector<HTMLInputElement>(
          'input[aria-label="Search governed entities"]',
        ),
      signal,
    );
    const childGlobal = context.window as unknown as typeof globalThis;
    const valueSetter = Object.getOwnPropertyDescriptor(
      childGlobal.HTMLInputElement.prototype,
      'value',
    )?.set?.bind(input);
    if (!valueSetter) throw new Error('The browser input value setter is unavailable.');
    valueSetter('roadmap');
    input.dispatchEvent(new childGlobal.Event('input', { bubbles: true }));
    let option: HTMLAnchorElement | null = null;
    try {
      option = await waitUntil(
        () =>
          context.document.querySelector<HTMLAnchorElement>(
            'a.global-search-option[role="option"][aria-selected="true"]',
          ),
        signal,
        6_000,
      );
    } catch {
      option = null;
    }
    if (!option) {
      const state = normalizeText(
        context.document.querySelector('.global-search-state')?.textContent,
      );
      record(
        'search.enter.activates',
        'SKIPPED',
        `No governed link result became available for “roadmap”${state ? ` (${state})` : ''}; Enter was not tested and no PASS was claimed.`,
      );
    } else {
      const href = new URL(option.href, context.window.location.origin);
      input.focus();
      triggerKeyboard(context, input, 'Enter', 'Enter');
      await waitUntil(
        () =>
          context.window.location.pathname === href.pathname &&
          context.window.location.search === href.search,
        signal,
      );
      record(
        'search.enter.activates',
        'PASS',
        `Enter navigated to ${stableRoute(context.window.location)}, matching the highlighted option.`,
      );
    }
  } catch (error) {
    record(
      'search.enter.activates',
      'FAIL',
      `Search keyboard scenario did not complete: ${reportError(error)}`,
    );
  }

  const narrowLayoutProblems: string[] = [];
  for (const scan of layoutScans) {
    if (scan.documentOverflow > 1) {
      narrowLayoutProblems.push(`${scan.route}: document overflow ${scan.documentOverflow}px`);
    }
    if (
      width < 1080 &&
      (scan.ganttClientWidth === null ||
        scan.ganttScrollWidth === null ||
        scan.ganttScrollWidth <= scan.ganttClientWidth ||
        !['auto', 'scroll'].includes(scan.ganttOverflowX ?? ''))
    ) {
      narrowLayoutProblems.push(
        `${scan.route}: Gantt ${scan.ganttScrollWidth ?? 'missing'}/${scan.ganttClientWidth ?? 'missing'} overflow-x ${scan.ganttOverflowX ?? 'missing'}`,
      );
    }
  }
  record(
    'layout.nooverflow',
    layoutScans.length > 0 && narrowLayoutProblems.length === 0 ? 'PASS' : 'FAIL',
    `${layoutScans.length} Home states measured; ${narrowLayoutProblems.length} containment violations${
      narrowLayoutProblems.length > 0 ? `: ${narrowLayoutProblems.slice(0, 5).join('; ')}` : ''
    }.${width < 1080 ? ' Narrow-width Gantt overflow was verified inside its own container.' : ''}`,
  );

  for (const definition of SELFTEST_ASSERTIONS) {
    if (!results.has(definition.id)) {
      record(
        definition.id,
        'SKIPPED',
        'The runner did not reach this assertion; no PASS was claimed.',
      );
    }
  }
  return SELFTEST_ASSERTIONS.map((definition) => results.get(definition.id)!).filter(Boolean);
}

export function parseRequestedSelfTestWidths(value: string | null): number[] {
  if (value === null) return [...SELFTEST_WIDTHS];
  const parsed = Number(value);
  return SELFTEST_WIDTHS.includes(parsed as (typeof SELFTEST_WIDTHS)[number])
    ? [parsed]
    : [...SELFTEST_WIDTHS];
}

export async function runSelfTestMatrix({
  commit,
  frame,
  signal,
  widths,
  onResult,
}: SelfTestRunnerOptions): Promise<SelfTestReport> {
  const results: SelfTestResult[] = [];
  for (const width of widths) {
    throwIfAborted(signal);
    const matrixWidth = SELFTEST_WIDTHS.find((candidate) => candidate === width);
    if (!matrixWidth) continue;
    const column = await runColumn(
      frame,
      matrixWidth,
      SELFTEST_HEIGHT_BY_WIDTH[matrixWidth],
      signal,
      (result) => onResult?.(result),
    );
    results.push(...column);
  }
  const report: SelfTestReport = {
    schemaVersion: SELFTEST_SCHEMA_VERSION,
    commit,
    generatedAt: new Date().toISOString(),
    widths: [...widths],
    summary: summarizeSelfTestResults(results),
    results,
  };
  return selfTestReportSchema.parse(report);
}
