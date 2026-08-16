import type { ReactNode } from 'react';

interface NoticeProps {
  tone?: 'info' | 'success' | 'error';
  children: ReactNode;
}

export function Notice({ tone = 'info', children }: NoticeProps) {
  return (
    <div
      aria-atomic="true"
      className={`notice ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
