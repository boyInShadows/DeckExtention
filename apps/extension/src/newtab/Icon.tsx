import type { ReactNode } from 'react';

type IconName = 'close' | 'menu' | 'edit' | 'check' | 'note';

const PATHS: Record<IconName, ReactNode> = {
  close: <path d="M5 5 19 19M19 5 5 19" />,
  menu: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13 7 4 4" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  note: <circle cx="12" cy="12" r="5" fill="currentColor" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: 16 | 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
