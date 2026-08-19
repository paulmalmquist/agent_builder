interface BrandProps {
  compact?: boolean;
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <div aria-hidden="true" className="brand-mark">
        <svg fill="none" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="25" />
          <path d="M22 45V19h11.5c8.2 0 13 4.4 13 11.2 0 6.9-4.8 11.3-13 11.3H22" />
          <path d="m34 41.5 12 11" />
          <circle className="brand-orbit-dot" cx="51" cy="14" r="3" />
        </svg>
      </div>
      <div className="brand-wordmark">
        <span>PAUL OS</span>
        <small>GOVERNED AGENT PLATFORM</small>
      </div>
    </div>
  );
}
