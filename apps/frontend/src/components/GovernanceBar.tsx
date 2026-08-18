import { Icon } from './Icon';

interface GovernanceBarProps {
  onExplain: () => void;
}

export function GovernanceBar({ onExplain }: GovernanceBarProps) {
  return (
    <footer className="governance-bar">
      <div className="governance-left">
        <Icon name="shield" size={35} />
        <div>
          <strong>Governed by Paul OS Protocols</strong>
          <span>Security · Access Control · Audit Logging · Evaluation · Versioning</span>
        </div>
      </div>
      <div aria-hidden="true" className="governance-divider" />
      <div className="help-copy">
        <Icon name="draft" />
        <span>Not sure where to start?</span>
      </div>
      <button className="explain-button" onClick={onExplain} type="button">
        EXPLAIN THE PROCESS
      </button>
    </footer>
  );
}
