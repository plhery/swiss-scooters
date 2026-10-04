import type { SVGProps } from 'react';

const paths = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  location: <path d="m21 3-7.5 18-3-7.5L3 10.5 21 3Z" />,
  filters: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 12h.01M12 12h.01M17 12h.01" strokeWidth="3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  close: <path d="m7 7 10 10M17 7 7 17" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  battery: (
    <>
      <rect x="2" y="6" width="17" height="12" rx="3" />
      <path d="M22 10v4M6 10v4M10 10v4M14 10v4" />
    </>
  ),
  range: (
    <>
      <path d="M4 18a9 9 0 1 1 16 0M12 12l4-4M5 13h1M18 13h1M12 5v1" />
      <circle cx="12" cy="13" r="1" />
    </>
  ),
  walk: (
    <>
      <circle cx="14" cy="4" r="2" />
      <path d="m7 21 4-7m5 7-2-6-4-3 2-5m-6 5 3-1 3-4 3 5 4 1" />
    </>
  ),
  scooter: (
    <>
      <circle cx="5" cy="18" r="3" />
      <circle cx="19" cy="18" r="3" />
      <path d="M5 18h9l5-9-2-6h-4M19 9v9" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  warning: (
    <>
      <path d="M12 4 2.5 20h19L12 4Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  locationOff: (
    <>
      <path d="m21 3-7.5 18-3-7.5L3 10.5 21 3Z" />
      <path d="M4 4l16 16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  recent: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 4v4.5H8M12 8v4.5l3 1.8" />
    </>
  ),
  map: (
    <>
      <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
    </>
  ),
  upDown: <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
} as const;

export default function Icon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
