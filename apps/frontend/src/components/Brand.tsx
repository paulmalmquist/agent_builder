import relativityLogo from '../assets/relativity-logo.svg';

interface BrandProps {
  compact?: boolean;
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <img alt="Relativity" className="brand-logo" src={relativityLogo} />
      <div className="brand-subtitle">AGENT BUILDER</div>
    </div>
  );
}
