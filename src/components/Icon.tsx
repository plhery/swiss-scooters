import type { SVGProps } from 'react';

const paths = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  location: <path d="m21 3-7.5 18-3-7.5L3 10.5 21 3Z" />,
  origin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-3 8-2-3-3-2 8-3Z" />
    </>
  ),
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
