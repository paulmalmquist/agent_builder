interface SurfaceHeaderProps {
  kicker: string;
  title: string;
  description: string;
  stateLabel?: string;
  stateDetail?: string;
}

export function SurfaceHeader({
  kicker,
  title,
  description,
  stateLabel = 'CONTROL PLANE ONLINE',
  stateDetail = 'POSTGRES LEDGER · ZOD CONTRACTS',
}: SurfaceHeaderProps) {
  return (
    <header className="os-surface-header">
      <div>
        <p className="page-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="os-system-state" role="status">
        <strong>{stateLabel}</strong>
        <small>{stateDetail}</small>
      </div>
    </header>
  );
}

interface InstrumentStripProps {
  readings: ReadonlyArray<{ label: string; value: string | number }>;
}

export function InstrumentStrip({ readings }: InstrumentStripProps) {
  return (
    <div className="instrument-strip">
      {readings.map((reading) => (
        <div className="instrument-reading" key={reading.label}>
          <span>{reading.label}</span>
          <strong>{reading.value}</strong>
        </div>
      ))}
    </div>
  );
}
