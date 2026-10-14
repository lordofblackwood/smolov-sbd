import type { ReactNode } from "react";
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    today: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v12h14V9" />
      </>
    ),
    program: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 4h2" />
      </>
    ),
    history: (
      <>
        <path d="M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h8" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1 1 4-2 2 2 4 3-1 2 3 4-1 1-3 3-1-1-4 2-2-2-4-3 1-2-3z" />
        <circle cx="12" cy="11" r="3" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    back: <path d="m15 4-8 8 8 8" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m5 5 14 14M5 19 19 5" />,
    weight: (
      <>
        <path d="M4 12h16M4 7v10M7 4v16M20 7v10M17 4v16" />
      </>
    ),
    link: (
      <>
        <path d="m9 14 6-6m-7 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 3" />
      </>
    ),
    flag: (
      <>
        <path d="M5 22V3h13l-2 5 2 5H5" />
      </>
    ),
    undo: (
      <>
        <path d="M4 9h10a6 6 0 1 1 0 12M4 9l5-5M4 9l5 5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    sync: (
      <>
        <path d="M20 7a9 9 0 0 0-15-1L2 9m0-6v6h6M4 17a9 9 0 0 0 15 1l3-3m0 6v-6h-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.weight}
    </svg>
  );
}
