import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useAgentSearch } from '../api/hooks';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Icon } from './Icon';

interface GlobalAgentSearchProps {
  onSelectAgent: (agentId: string) => void;
}

const minimumQueryLength = 2;

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

export function GlobalAgentSearch({ onSelectAgent }: GlobalAgentSearchProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusInputOnExpandRef = useRef(false);
  const restoreTriggerFocusRef = useRef(false);
  const expandedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const search = useAgentSearch(
    debouncedQuery,
    expanded && debouncedQuery.length >= minimumQueryLength,
    false,
  );
  const items = search.data?.items ?? [];

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

  function selectAgent(agentId: string) {
    onSelectAgent(agentId);
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
      if (selected) selectAgent(selected.id);
    }
  }

  return (
    <div className="global-search" data-expanded={expanded}>
      <button
        aria-expanded={expanded}
        aria-label="Search governed agents"
        className="global-search-trigger"
        onClick={() => {
          focusInputOnExpandRef.current = true;
          setExpanded(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <Icon name="search" size={18} />
        <span>SEARCH</span>
        <kbd>⌘K</kbd>
      </button>
      {expanded ? (
        <div className="global-search-expanded">
          <span aria-hidden="true" className="global-search-icon">
            <Icon name="search" size={18} />
          </span>
          <input
            aria-activedescendant={
              activeIndex >= 0 && items[activeIndex]
                ? `${listboxId}-option-${items[activeIndex].id}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={expanded}
            aria-label="Search governed agents"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search agents, departments, capabilities…"
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
          {query.trim().length >= minimumQueryLength ? (
            <div className="global-search-results" id={listboxId} role="listbox">
              {search.isLoading || debouncedQuery !== query.trim() ? (
                <div className="global-search-state">SCANNING GOVERNED CATALOG…</div>
              ) : null}
              {search.isError ? (
                <div className="global-search-state error">CATALOG SEARCH UNAVAILABLE</div>
              ) : null}
              {!search.isLoading &&
              !search.isError &&
              debouncedQuery === query.trim() &&
              items.length === 0 ? (
                <div className="global-search-state">NO MATCHING AGENTS</div>
              ) : null}
              {debouncedQuery === query.trim()
                ? items.map((agent, index) => (
                    <button
                      aria-selected={index === activeIndex}
                      className="global-search-option"
                      id={`${listboxId}-option-${agent.id}`}
                      key={agent.id}
                      onClick={() => selectAgent(agent.id)}
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
                  ))
                : null}
            </div>
          ) : null}
          <span aria-live="polite" className="sr-only" role="status">
            {debouncedQuery.length >= minimumQueryLength && !search.isLoading
              ? `${items.length} result${items.length === 1 ? '' : 's'} available.`
              : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
