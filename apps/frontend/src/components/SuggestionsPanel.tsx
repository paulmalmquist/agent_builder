import type { AgentSearchItem } from '../api/client';
import { Icon } from './Icon';

interface SuggestionsPanelProps {
  items: AgentSearchItem[];
  isLoading: boolean;
  query: string;
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
  onBuildNew: () => void;
}

export function SuggestionsPanel({
  items,
  isLoading,
  query,
  selectedAgentId,
  onSelect,
  onBuildNew,
}: SuggestionsPanelProps) {
  return (
    <section aria-busy={isLoading} aria-labelledby="suggested-agents" className="suggestions-panel">
      <div className="panel-title">
        <span id="suggested-agents">{query ? 'REUSE CANDIDATES' : 'SUGGESTED AGENTS'}</span>
        <Icon name="sparkles" size={18} />
      </div>
      <div className="agent-list">
        {isLoading ? <div className="suggestion-state">Finding governed agents…</div> : null}
        {!isLoading && items.length === 0 ? (
          <div className="suggestion-state">
            No close match yet. Refine the scope or start a new agent.
          </div>
        ) : null}
        {items.map((agent) => (
          <button
            aria-pressed={selectedAgentId === agent.id}
            className={`agent-row ${selectedAgentId === agent.id ? 'selected' : ''}`}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            type="button"
          >
            <span className="agent-icon">
              <Icon name="agent" size={25} />
            </span>
            <span className="agent-copy">
              <span className="agent-name-line">
                <strong>{agent.name}</strong>
                <span className="match-chip">{agent.score}% MATCH</span>
              </span>
              <span className="agent-description">{agent.purpose}</span>
            </span>
            <span className="row-chevron">
              <Icon name="arrow" size={22} />
            </span>
          </button>
        ))}
        <button className="agent-row build-new" onClick={onBuildNew} type="button">
          <span className="new-icon">
            <Icon name="plus" size={23} />
          </span>
          <span className="agent-copy">
            <strong>None of these fit — Build a new agent</strong>
          </span>
          <span className="row-chevron">
            <Icon name="arrow" size={22} />
          </span>
        </button>
      </div>
    </section>
  );
}
