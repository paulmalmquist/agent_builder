import type { CSSProperties } from 'react';
import { isLocalConnectorAssetSource } from './asset-source';
import './connector-marks.css';

export interface ConnectorMarkDefinition {
  monogram: string;
  accent: string;
  /** A browser-served, same-application SVG path. Remote URLs and data URLs are rejected. */
  assetSrc?: string | null;
}

interface ConnectorMarkProps {
  active?: boolean;
  compact?: boolean;
  definition: ConnectorMarkDefinition;
  label: string;
}

export function ConnectorMark({
  active = false,
  compact = false,
  definition,
  label,
}: ConnectorMarkProps) {
  const assetSrc =
    definition.assetSrc && isLocalConnectorAssetSource(definition.assetSrc)
      ? definition.assetSrc
      : null;
  const style = { '--connector-accent': definition.accent } as CSSProperties;

  return (
    <span
      aria-label={`${label} connector`}
      className="connector-mark"
      data-active={active}
      data-compact={compact}
      data-has-local-asset={assetSrc !== null}
      role="img"
      style={style}
    >
      <span aria-hidden="true" className="connector-mark-monogram">
        {definition.monogram}
      </span>
      {assetSrc ? (
        <img
          alt=""
          aria-hidden="true"
          decoding="async"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          src={assetSrc}
        />
      ) : null}
    </span>
  );
}
