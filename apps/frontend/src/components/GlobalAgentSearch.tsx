import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  agentResourceSpecSchema,
  roadmapResourceSpecSchema,
  type ResourceVersion,
} from '@agent-builder/contracts';
import { Link, useNavigate } from 'react-router-dom';
import { useAgentSearch, usePlatformResources } from '../api/hooks';
import type { AgentSearchItem } from '../api/client';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Icon } from './Icon';
import { distinctResourceVersions, isQuarantinedLegacyAgent } from '../lib/user-facing-index';
import './global-entity-search.css';

interface GlobalAgentSearchProps {
  onSelectAgent: (agentId: string) => void;
}

type KnowledgeType =
  | 'systems'
  | 'decisions'
  | 'datasets'
  | 'runbooks'
  | 'metrics'
  | 'agents'
  | 'projects';

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
  Project: 'projects',
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

function resourceSubtitle(resource: ResourceVersion) {
  const kind = resource.kind === 'Agent' ? 'Agent definition' : displayKind(resource.kind);
  return `${kind} V${resource.version} · ${resource.owner}`;
}

function resourceRoute(resource: ResourceVersion) {
  if (resource.kind === 'Agent') {
    return `/catalog?${new URLSearchParams({ resource: resource.id }).toString()}`;
  }
  if (resource.kind === 'Roadmap') {
    const parsed = roadmapResourceSpecSchema.safeParse(resource.definition.spec);
    if (parsed.success) {
      return `/roadmaps?${new URLSearchParams({ fork: parsed.data.fork.id }).toString()}`;
    }
  }
  const type = knowledgeTypeByKind[resource.kind];
  if (type) {
    return `/knowledge?${new URLSearchParams({ type, entity: resource.id }).toString()}`;
  }
  return `/registry?${new URLSearchParams({ query: resource.slug }).toString()}`;
}

export function GlobalAgentSearch({ onSelectAgent }: GlobalAgentSearchProps) {
  const listboxId = useId();
  const governedAgentGroupId = useId();
  const legacyAgentGroupId = useId();
  const otherResourceGroupId = useId();
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
  const resources =
    currentResults && !resourceSearch.isError
      ? distinctResourceVersions(resourceSearch.data?.items ?? [])
      : [];
  const governedAgents = resources.filter((resource) => resource.kind === 'Agent');
  const otherResources = resources.filter((resource) => resource.kind !== 'Agent');
  const canonicallyLinkedLegacyIds = new Set(
    governedAgents.flatMap((resource) => {
      const parsed = agentResourceSpecSchema.safeParse(resource.definition.spec);
      return parsed.success && parsed.data.legacyCompatibility
        ? [parsed.data.legacyCompatibility.agentId]
        : [];
    }),
  );
  const agents =
    currentResults && !agentSearch.isError
      ? (agentSearch.data?.items ?? []).filter(
          (agent) => !isQuarantinedLegacyAgent(agent) && !canonicallyLinkedLegacyIds.has(agent.id),
        )
      : [];
  const items: PaletteItem[] = [
    ...governedAgents.map((value) => ({
      key: `resource-${value.id}`,
      type: 'resource' as const,
      value,
    })),
    ...agents.map((value) => ({ key: `agent-${value.id}`, type: 'agent' as const, value })),
    ...otherResources.map((value) => ({
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
    collapse(false);
    if (item.type === 'agent') onSelectAgent(item.value.id);
    else void navigate(resourceRoute(item.value));
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
            placeholder="Search agents, roadmaps, systems, datasets…"
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
                {governedAgents.length > 0 ? (
                  <div aria-labelledby={governedAgentGroupId} role="group">
                    <span className="global-search-group-label" id={governedAgentGroupId}>
                      GOVERNED AGENTS · {governedAgents.length}
                    </span>
                    {governedAgents.map((resource, index) => (
                      <Link
                        aria-selected={index === activeIndex}
                        className="global-search-option"
                        id={`${listboxId}-option-resource-${resource.id}`}
                        key={resource.id}
                        onClick={() => collapse(false)}
                        onPointerMove={() => setActiveIndex(index)}
                        role="option"
                        tabIndex={-1}
                        to={resourceRoute(resource)}
                      >
                        <span>
                          <strong>{highlightedText(resource.name, debouncedQuery)}</strong>
                          <small title={resourceSubtitle(resource)}>
                            Agent definition V{resource.version} · {resource.owner}
                          </small>
                        </span>
                        <span className="global-search-kind">{resource.lifecycle} definition</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
                {agents.length > 0 ? (
                  <div aria-labelledby={legacyAgentGroupId} role="group">
                    <span className="global-search-group-label" id={legacyAgentGroupId}>
                      LEGACY AGENTS NOT YET IMPORTED · {agents.length}
                    </span>
                    {agents.map((agent, agentIndex) => {
                      const index = governedAgents.length + agentIndex;
                      return (
                        <button
                          aria-selected={index === activeIndex}
                          className="global-search-option"
                          id={`${listboxId}-option-agent-${agent.id}`}
                          key={agent.id}
                          onClick={() =>
                            selectItem({ key: `agent-${agent.id}`, type: 'agent', value: agent })
                          }
                          onPointerMove={() => setActiveIndex(index)}
                          role="option"
                          tabIndex={-1}
                          type="button"
                        >
                          <span>
                            <strong>{highlightedText(agent.name, debouncedQuery)}</strong>
                            <small title={agent.department}>
                              {highlightedText(agent.department, debouncedQuery)}
                            </small>
                          </span>
                          <span className={`status-chip ${agent.status}`}>
                            legacy {agent.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {otherResources.length > 0 ? (
                  <div aria-labelledby={otherResourceGroupId} role="group">
                    <span className="global-search-group-label" id={otherResourceGroupId}>
                      OTHER GOVERNED DEFINITIONS · {otherResources.length}
                    </span>
                    {otherResources.map((resource, resourceIndex) => {
                      const index = governedAgents.length + agents.length + resourceIndex;
                      return (
                        <Link
                          aria-selected={index === activeIndex}
                          className="global-search-option"
                          id={`${listboxId}-option-resource-${resource.id}`}
                          key={resource.id}
                          onClick={() => collapse(false)}
                          onPointerMove={() => setActiveIndex(index)}
                          role="option"
                          tabIndex={-1}
                          to={resourceRoute(resource)}
                        >
                          <span>
                            <strong>{highlightedText(resource.name, debouncedQuery)}</strong>
                            <small title={resourceSubtitle(resource)}>
                              {displayKind(resource.kind)} V{resource.version} · {resource.owner}
                            </small>
                          </span>
                          <span className="global-search-kind">
                            {resource.lifecycle} definition
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <span aria-live="polite" className="sr-only" role="status">
            {searchEnabled && currentResults && !isLoading
              ? `${items.length} result${items.length === 1 ? '' : 's'} available across governed agents, legacy agents, and other definitions.`
              : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
