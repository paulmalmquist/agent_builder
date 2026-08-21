import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SELFTEST_SCHEMA_VERSION,
  summarizeSelfTestResults,
  type SelfTestReport,
  type SelfTestResult,
} from '@agent-builder/contracts';
import { useSearchParams } from 'react-router-dom';
import { consoleBuildCommit } from '../../config/build-identity';
import {
  SELFTEST_ASSERTIONS,
  SELFTEST_HEIGHT_BY_WIDTH,
  parseRequestedSelfTestWidths,
  runSelfTestMatrix,
} from './selftest-runner';
import './selftest.css';

declare global {
  interface Window {
    __PAUL_OS_SELFTEST_REPORT__?: SelfTestReport;
  }
}

function serializeReport(report: SelfTestReport | null): string {
  if (!report) return '';
  return JSON.stringify(report).replace(/[<>&\u2028\u2029]/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? '' : `\\u${codePoint.toString(16).padStart(4, '0')}`;
  });
}

function unavailableReport(widths: readonly number[], reason: string): SelfTestReport {
  const results: SelfTestResult[] = widths.flatMap((width) =>
    SELFTEST_ASSERTIONS.map((assertion) => ({
      id: assertion.id,
      width,
      status: 'SKIPPED' as const,
      description: assertion.description,
      expected: assertion.expected,
      actual: `Harness runner unavailable: ${reason.slice(0, 300)} No PASS was claimed.`,
      route: assertion.route,
    })),
  );
  return {
    schemaVersion: SELFTEST_SCHEMA_VERSION,
    commit: consoleBuildCommit,
    generatedAt: new Date().toISOString(),
    widths: [...widths],
    summary: summarizeSelfTestResults(results),
    results,
  };
}

function statusLabel(report: SelfTestReport | null, running: boolean): string {
  if (running) return 'RUNNING';
  if (!report) return 'NOT STARTED';
  if (report.summary.fail > 0) return 'FAILURES RECORDED';
  if (report.summary.skipped > 0) return 'COMPLETE WITH SKIPS';
  return 'COMPLETE';
}

export function SelfTestPage() {
  const [searchParams] = useSearchParams();
  const widthQuery = searchParams.get('w');
  const widths = useMemo(() => parseRequestedSelfTestWidths(widthQuery), [widthQuery]);
  const widthKey = widths.join(',');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const runSequence = useRef(0);
  const [rerunKey, setRerunKey] = useState(0);
  const [partialResults, setPartialResults] = useState<SelfTestResult[]>([]);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const controller = new AbortController();
    const sequence = ++runSequence.current;
    setRunning(true);
    setReport(null);
    setPartialResults([]);
    delete window.__PAUL_OS_SELFTEST_REPORT__;

    void runSelfTestMatrix({
      commit: consoleBuildCommit,
      frame,
      signal: controller.signal,
      widths,
      onResult: (result) => {
        if (sequence !== runSequence.current) return;
        setPartialResults((current) => {
          const withoutPrevious = current.filter(
            (candidate) => !(candidate.id === result.id && candidate.width === result.width),
          );
          return [...withoutPrevious, result];
        });
      },
    })
      .then((completedReport) => {
        if (sequence !== runSequence.current) return;
        window.__PAUL_OS_SELFTEST_REPORT__ = completedReport;
        setReport(completedReport);
        setPartialResults(completedReport.results);
        setRunning(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || sequence !== runSequence.current) return;
        const reason = error instanceof Error ? error.message : 'Unknown acceptance runner error.';
        const completedReport = unavailableReport(widths, reason);
        window.__PAUL_OS_SELFTEST_REPORT__ = completedReport;
        setReport(completedReport);
        setPartialResults(completedReport.results);
        setRunning(false);
      });

    return () => controller.abort();
  }, [rerunKey, widthKey, widths]);

  const currentWidth = partialResults.at(-1)?.width ?? widths[0] ?? 390;
  const currentHeight =
    SELFTEST_HEIGHT_BY_WIDTH[currentWidth as keyof typeof SELFTEST_HEIGHT_BY_WIDTH] ?? 844;
  const visibleResults = report?.results ?? partialResults;
  const summary = report?.summary ?? summarizeSelfTestResults(visibleResults);
  const serializedReport = serializeReport(report);
  const completionState = running ? 'running' : 'complete';

  return (
    <main className="selftest-page" data-selftest-status={completionState}>
      <header className="selftest-heading">
        <div>
          <span>READ-ONLY ACCEPTANCE INSTRUMENT</span>
          <h1>Self-verification</h1>
          <p>
            Paul OS loads its real Home route inside exact same-origin iframe viewports and measures
            rendered DOM, geometry, URL history, pointer paths, and keyboard handlers.
          </p>
        </div>
        <div
          className="selftest-verdict"
          data-state={running ? 'running' : report?.summary.fail ? 'fail' : 'complete'}
        >
          <span>RUN STATE</span>
          <strong>{statusLabel(report, running)}</strong>
          <small>{widths.join(' · ')} CSS PX</small>
        </div>
      </header>

      <section aria-labelledby="selftest-boundary-title" className="selftest-boundary">
        <div>
          <span>EXECUTION BOUNDARY</span>
          <h2 id="selftest-boundary-title">Real application · no governed writes</h2>
          <p>
            The runner issues only the application’s existing read requests. It never approves,
            rejects, promotes, installs, writes memory, or calls the self-test API recursively.
            Anything it cannot prove is marked SKIPPED with a reason.
          </p>
        </div>
        <button
          disabled={running}
          onClick={() => setRerunKey((current) => current + 1)}
          type="button"
        >
          {running ? 'RUNNING…' : 'RUN AGAIN · READ ONLY'}
        </button>
      </section>

      <section aria-labelledby="selftest-summary-title" className="selftest-summary">
        <header>
          <span>01 · CURRENT RESULT</span>
          <h2 id="selftest-summary-title">Acceptance matrix</h2>
        </header>
        <dl>
          <div data-status="pass">
            <dt>Pass</dt>
            <dd>{summary.pass}</dd>
          </div>
          <div data-status="fail">
            <dt>Fail</dt>
            <dd>{summary.fail}</dd>
          </div>
          <div data-status="skipped">
            <dt>Skipped</dt>
            <dd>{summary.skipped}</dd>
          </div>
          <div>
            <dt>Source commit</dt>
            <dd>{report?.commit ?? consoleBuildCommit ?? 'UNAVAILABLE'}</dd>
          </div>
        </dl>
        <p aria-live="polite" role="status">
          {running
            ? `Running width ${currentWidth}×${currentHeight}. ${visibleResults.length} checks recorded so far.`
            : `Completed ${visibleResults.length} checks at ${widths.length} ${widths.length === 1 ? 'width' : 'widths'}.`}
        </p>
      </section>

      <section aria-labelledby="selftest-live-title" className="selftest-live">
        <header>
          <span>02 · LIVE TEST SUBJECT</span>
          <h2 id="selftest-live-title">Measured iframe</h2>
          <p>
            The frame is deliberately sized in CSS pixels. The runner checks its innerWidth and
            innerHeight before accepting any result from that column.
          </p>
        </header>
        <div className="selftest-frame-stage">
          <iframe
            aria-label="Live Paul OS application under acceptance test"
            data-testid="selftest-frame"
            height={currentHeight}
            ref={frameRef}
            title="Live Paul OS application under acceptance test"
            width={currentWidth}
          />
        </div>
      </section>

      <section aria-labelledby="selftest-results-title" className="selftest-results">
        <header>
          <span>03 · ASSERTION EVIDENCE</span>
          <h2 id="selftest-results-title">Expected against observed</h2>
        </header>
        <div className="selftest-table-scroll">
          <table>
            <caption>
              Read-only acceptance results from the live application iframe. A skipped row is not a
              pass.
            </caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Width</th>
                <th scope="col">Assertion</th>
                <th scope="col">Route</th>
                <th scope="col">Expected</th>
                <th scope="col">Actual</th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.map((result) => (
                <tr
                  data-status={result.status.toLocaleLowerCase()}
                  key={`${result.width}:${result.id}`}
                >
                  <td>
                    <strong>{result.status}</strong>
                  </td>
                  <td>{result.width}</td>
                  <th scope="row">
                    <code>{result.id}</code>
                    <span>{result.description}</span>
                  </th>
                  <td>
                    <code>{result.route}</code>
                  </td>
                  <td>{result.expected}</td>
                  <td>{result.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <script id="paul-os-selftest-report" type="application/json">
        {serializedReport}
      </script>
    </main>
  );
}
