import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ResourceVersion } from '@agent-builder/contracts';
import { useNavigate } from 'react-router-dom';
import { useAgentSearch, usePlatformResources } from '../api/hooks';
import type { AgentSearchItem } from '../api/client';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Icon } from './Icon';
import './global-entity-search.css';

interface GlobalAgentSearchProps {
  onSelectAgent: (agentId: string) => void;
}

type KnowledgeType = 'systems' | 'decisions' | 'datasets' | 'runbooks' | 'metrics' | 'agents';

type PaletteItem =
  | { key: string; type: 'agent'; value: AgentSearchItem }
  | { key: string; type: 'resource'; value: ResourceVersion };

const minimumQueryLength = 2;
const knowledgeTypeByKind: Partial<Record<ResourceVersion['kind'], KnowledgeType>> = {
  Agent: 'agents',
  KnowledgeSource: 'datasets',
  MetricDefinition: 'metrics',
  Plugin: 'systems',
  PluginPack: 'systems',
  Protocol: 'decisions',
  Reference: 'runbooks',
  Skill: 'agents',
};

function highlightedText(value: string, query: string): ReactNode {
  const start = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (start < 0) return value;
  const end = start + query.length;
  return (
    <>
      {value.slice(0, start)}
      <mark>{value.slice(start, end)}</mark>
      {value.slice(end)}
    </>
  );
}

function displayKind(kind: ResourceVersion['kind']) {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function resourceRoute(resource: ResourceVersion) {
  const type = knowledgeTypeByKind[resource.kind];
  if (type) {
    return `/knowledge?${new URLSearchParams({ type, entity: resource.id }).toString()}`;
  }
  return `/registry?${new URLSearchParams({ query: resource.slug }).toString()}`;
}

export function GlobalAgentSearch({ onSelectAgent }: GlobalAgentSearchProps) {
  const listboxId = useId();
  const agentGroupId = useId();
  const resourceGroupId = useId();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusInputOnExpandRef = useRef(false);
  const restoreTriggerFocusRef = useRef(false);
  const expandedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, 250);
  const searchEnabled = expanded && debouncedQuery.length >= minimumQueryLength;
  const agentSearch = useAgentSearch(debouncedQuery, searchEnabled, false);
  const resourceSearch = usePlatformResources({ query: debouncedQuery, limit: 20 }, searchEnabled);
  const currentResults = debouncedQuery === trimmedQuery;
  const agents = currentResults && !agentSearch.isError ? (agentSearch.data?.items ?? []) : [];
  const resources =
    currentResults && !resourceSearch.isError ? (resourceSearch.data?.items ?? []) : [];
  const items: PaletteItem[] = [
    ...agents.map((value) => ({ key: `agent-${value.id}`, type: 'agent' as const, value })),
    ...resources.map((value) => ({
      key: `resource-${value.id}`,
      type: 'resource' as const,
      value,
    })),
  ];
  const isLoading =
    !currentResults || (searchEnabled && (agentSearch.isLoading || resourceSearch.isLoading));

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        focusInputOnExpandRef.current = true;
        setExpanded(true);
        if (expandedRef.current) inputRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    setActiveIndex(items.length > 0 ? 0 : -1);
  }, [debouncedQuery, items.length]);

  useEffect(() => {
    expandedRef.current = expanded;
    if (expanded && focusInputOnExpandRef.current) {
      focusInputOnExpandRef.current = false;
      inputRef.current?.focus();
    }
    if (!expanded && restoreTriggerFocusRef.current) {
      restoreTriggerFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [expanded]);

  function collapse(restoreTriggerFocus = true) {
    restoreTriggerFocusRef.current = restoreTriggerFocus;
    setExpanded(false);
    setQuery('');
    setActiveIndex(-1);
  }

  function selectItem(item: PaletteItem) {
    if (item.type === 'agent') onSelectAgent(item.value.id);
    else void navigate(resourceRoute(item.value));
    collapse(false);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      collapse();
      return;
    }
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? items.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const selected = items[activeIndex];
      if (selected) selectItem(selected);
    }
  }

  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;

  return (
    <div className="global-search" data-expanded={expanded}>
      <button
        aria-expanded={expanded}
        aria-label="Search governed entities"
        className="global-search-trigger"
        onClick={() => {
          focusInputOnExpandRef.current = true;
          setExpanded(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <Icon name="search" size={18} />
        <span>SEARCH ENTITIES</span>
        <kbd>⌘K</kbd>
      </button>
      {expanded ? (
        <div className="global-search-expanded">
          <span aria-hidden="true" className="global-search-icon">
            <Icon name="search" size={18} />
          </span>
          <input
            aria-activedescendant={activeItem ? `${listboxId}-option-${activeItem.key}` : undefined}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={expanded}
            aria-label="Search governed entities"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search agents, systems, datasets, rules…"
            ref={inputRef}
            role="combobox"
            value={query}
          />
          <button
            aria-label="Close search"
            className="global-search-close"
            onClick={() => collapse()}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
          {trimmedQuery.length >= minimumQueryLength ? (
            <div className="global-search-results">
              {isLoading ? (
                <div className="global-search-state">SCANNING GOVERNED INDEX…</div>
              ) : null}
              {currentResults && agentSearch.isError ? (
                <div className="global-search-state error" role="alert">
                  AGENT CATALOG UNAVAILABLE
                </div>
              ) : null}
              {currentResults && resourceSearch.isError ? (
                <div className="global-search-state error" role="alert">
                  DEFINITION INDEX UNAVAILABLE
                </div>
              ) : null}
              {currentResults &&
              !isLoading &&
              !agentSearch.isError &&
              !resourceSearch.isError &&
              items.length === 0 ? (
                <div className="global-search-state">NO MATCHING ENTITIES</div>
              ) : null}
              <div id={listboxId} role="listbox">
                {agents.length > 0 ? (
                  <div aria-labelledby={agentGroupId} role="group">
                    <span className="global-search-group-label" id={agentGroupId}>
                      LEGACY AGENT CATALOG · {agents.length}
                    </span>
                    {agents.map((agent, index) => (
                      <button
                        aria-selected={index === activeIndex}
                        className="global-search-option"
                        id={`${listboxId}-option-agent-${agent.id}`}
                        key={agent.id}
                        onClick={() =>
                          selectItem({ key: `agent-${agent.id}`, type: 'agent', value: agent })
                        }
                        onMouseEnter={() => setActiveIndex(index)}
                        role="option"
                        type="button"
                      >
                        <span>
                          <strong>{highlightedText(agent.name, debouncedQuery)}</strong>
                          <small>{highlightedText(agent.department, debouncedQuery)}</small>
                        </span>
                        <span className={`status-chip ${agent.status}`}>{agent.status}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {resources.length > 0 ? (
                  <div aria-labelledby={resourceGroupId} role="group">
                    <span className="global-search-group-label" id={resourceGroupId}>
                      GOVERNED DEFINITIONS · {resources.length}
                    </span>
                    {resources.map((resource, resourceIndex) => {
                      const index = agents.length + resourceIndex;
                      return (
                        <button
                          aria-selected={index === activeIndex}
                          className="global-search-option"
                          id={`${listboxId}-option-resource-${resource.id}`}
                          key={resource.id}
                          onClick={() =>
                            selectItem({
                              key: `resource-${resource.id}`,
                              type: 'resource',
                              value: resource,
                            })
                          }
                          onMouseEnter={() => setActiveIndex(index)}
                          role="option"
                          type="button"
                        >
                          <span>
                            <strong>{highlightedText(resource.name, debouncedQuery)}</strong>
                            <small>
                              {displayKind(resource.kind)} · {resource.owner}
                            </small>
                          </span>
                          <span className="global-search-kind">{resource.lifecycle}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <span aria-live="polite" className="sr-only" role="status">
            {searchEnabled && currentResults && !isLoading
              ? `${items.length} result${items.length === 1 ? '' : 's'} available across agents and governed definitions.`
              : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
