export interface AimManifestIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

interface ManifestErrorPanelProps {
  issues: readonly AimManifestIssue[];
}

export function ManifestErrorPanel({ issues }: ManifestErrorPanelProps) {
  return (
    <main className="os-surface aim-surface">
      <section className="aim-manifest-error" role="alert">
        <span>MANIFEST INVALID</span>
        <h1>AIM cannot render this program safely.</h1>
        <p>
          Correct the local manifest and reload this route. No stale or inferred program state is
          shown.
        </p>
        <ol>
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${issue.path}:${index}`}>
              <code>{issue.path || '$'}</code>
              <span>{issue.message}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
