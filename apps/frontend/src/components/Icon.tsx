import type { ReactNode } from 'react';

type IconName =
  | 'agent'
  | 'arrow'
  | 'check'
  | 'close'
  | 'code'
  | 'database'
  | 'draft'
  | 'help'
  | 'library'
  | 'plus'
  | 'search'
  | 'scope'
  | 'shield'
  | 'success';

interface IconProps {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, ReactNode> = {
  agent: (
    <>
      <path d="M4 18v-5l4-4 3 3 5-6 4 3v9" />
      <path d="M4 20h16" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  code: (
    <>
      <path d="m8 9-3 3 3 3" />
      <path d="m16 9 3 3-3 3" />
      <path d="m14 5-4 14" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </>
  ),
  draft: (
    <>
      <path d="M7 5h10v14H7z" />
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <path d="M10 9h4M10 12h4M10 15h2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.3 2.3 0 1 1 3 2.2c-.8.3-.8.8-.8 1.8" />
      <path d="M12 17h.01" />
    </>
  ),
  library: (
    <>
      <path d="M4 5.5h6.5V20H4zM13.5 5.5H20V20h-6.5z" />
      <path d="M6.5 9h1.5M16 9h1.5M6.5 12h1.5M16 12h1.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  scope: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.7 3 7.8 7.5 9.5 4.5-1.7 7.5-4.8 7.5-9.5V6L12 3Z" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  success: (
    <>
      <path d="M4 20V9" />
      <path d="M4 20h17" />
      <path d="m7 16 4-4 3 2 6-7" />
    </>
  ),
};

export function Icon({ name, size = 24 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
