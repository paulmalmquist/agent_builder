import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './Brand';

export interface PlatformRailItem {
  active: boolean;
  badge?: number;
  group: 'daily' | 'workspace' | 'settings';
  label: string;
  number: string;
  path: string;
  unavailable?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  );
}

export function PlatformRail({
  collapsed,
  items,
  onToggle,
}: {
  collapsed: boolean;
  items: readonly PlatformRailItem[];
  onToggle: () => void;
}) {
  const [visibleTooltip, setVisibleTooltip] = useState<{
    label: string;
    top: number;
  } | null>(null);

  useEffect(() => {
    function handleCollapseShortcut(event: globalThis.KeyboardEvent) {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      onToggle();
    }

    document.addEventListener('keydown', handleCollapseShortcut);
    return () => document.removeEventListener('keydown', handleCollapseShortcut);
  }, [onToggle]);

  function preventShortcutPropagation(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === '[') event.stopPropagation();
  }

  function showCollapsedLabel(item: PlatformRailItem, target: HTMLElement) {
    if (!collapsed) return;
    const bounds = target.getBoundingClientRect();
    setVisibleTooltip({ label: item.label, top: bounds.top + bounds.height / 2 });
  }

  function hideCollapsedLabel() {
    setVisibleTooltip(null);
  }

  const dailyItems = items.filter((item) => item.group === 'daily');
  const operatingItems = items.filter((item) => item.group === 'workspace');
  const settingsItems = items.filter((item) => item.group === 'settings');

  function navItem(item: PlatformRailItem) {
    return (
      <Link
        aria-current={item.active ? 'page' : undefined}
        aria-describedby={
          collapsed && visibleTooltip?.label === item.label ? 'platform-rail-tooltip' : undefined
        }
        aria-label={collapsed ? item.label : undefined}
        className={item.active ? 'platform-rail-link active' : 'platform-rail-link'}
        key={item.path}
        onBlur={hideCollapsedLabel}
        onFocus={(event) => showCollapsedLabel(item, event.currentTarget)}
        onKeyDown={preventShortcutPropagation}
        onMouseEnter={(event) => showCollapsedLabel(item, event.currentTarget)}
        onMouseLeave={hideCollapsedLabel}
        title={collapsed ? item.label : undefined}
        to={item.path}
      >
        <span aria-hidden="true" className="platform-rail-number">
          {item.number}
        </span>
        <span className="platform-rail-label">{item.label}</span>
        {item.badge && item.badge > 0 ? (
          <span aria-label={`${item.badge} decisions need review`} className="attention-badge">
            {item.badge}
          </span>
        ) : null}
        {item.unavailable ? (
          <span aria-label={`${item.label} unavailable`} className="platform-rail-warning">
            !
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <aside aria-label="Paul OS sections" className="platform-rail">
      <Link aria-label="Open Paul OS Today" className="platform-rail-brand" to="/">
        <Brand compact />
      </Link>
      <button
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        aria-pressed={collapsed}
        className="platform-rail-toggle"
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
      </button>
      <nav aria-label="Paul OS" className="platform-rail-navigation">
        <div className="platform-rail-group">{dailyItems.map(navItem)}</div>
        <div aria-hidden="true" className="platform-rail-separator" />
        <div className="platform-rail-group">{operatingItems.map(navItem)}</div>
        {settingsItems.length > 0 ? (
          <>
            <div aria-hidden="true" className="platform-rail-separator" />
            <div className="platform-rail-group">{settingsItems.map(navItem)}</div>
          </>
        ) : null}
      </nav>
      <footer className="platform-rail-footer">
        <span>⌘K&nbsp; SEARCH</span>
        <span>[&nbsp;&nbsp; {collapsed ? 'EXPAND' : 'COLLAPSE'}</span>
        <small>WORKSPACE SCOPED</small>
      </footer>
      {collapsed && visibleTooltip ? (
        <span
          className="platform-rail-tooltip"
          id="platform-rail-tooltip"
          role="tooltip"
          style={{ top: visibleTooltip.top }}
        >
          {visibleTooltip.label}
        </span>
      ) : null}
    </aside>
  );
}
