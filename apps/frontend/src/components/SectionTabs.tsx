import { NavLink } from 'react-router-dom';

export interface SectionTab {
  label: string;
  path: string;
}

export function SectionTabs({ label, tabs }: { label: string; tabs: readonly SectionTab[] }) {
  return (
    <nav aria-label={label} className="section-tabs">
      {tabs.map((tab) => (
        <NavLink
          className={({ isActive }) => (isActive ? 'active' : undefined)}
          end={tab.path.split('?')[0] !== '/catalog'}
          key={tab.path}
          to={tab.path}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
