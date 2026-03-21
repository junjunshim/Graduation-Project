import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'database'
  | 'search'
  | 'calendar'
  | 'clock'
  | 'checkCircle'
  | 'sparkles'
  | 'page'
  | 'arrowRight'
  | 'chevronRight'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'moon'
  | 'sun'

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
}

const iconPaths: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3.5" />
      <path d="M4.5 5.5v6c0 1.93 3.36 3.5 7.5 3.5s7.5-1.57 7.5-3.5v-6" />
      <path d="M4.5 11.5v6c0 1.93 3.36 3.5 7.5 3.5s7.5-1.57 7.5-3.5v-6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M8 3.5V7" />
      <path d="M16 3.5V7" />
      <path d="M4 9.5h16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.5 2" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.4 2.4 4.8-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" />
      <path d="M18.5 15.5l.8 2 .9-2 .8-.8-2-.9-.5-1.8-.7 1.8-1.8.9 1.7.8z" />
      <path d="M5.5 15.5l.8 2 .9-2 .8-.8-2-.9-.5-1.8-.7 1.8-1.8.9 1.7.8z" />
    </>
  ),
  page: (
    <>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12h6" />
      <path d="M9 15.5h6" />
    </>
  ),
  arrowRight: <path d="M5 12h13M13 6l6 6-6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  minimize: <path d="M5 12.5h14" />,
  maximize: <rect x="5.5" y="5.5" width="13" height="13" rx="1.75" />,
  restore: (
    <>
      <path d="M9 9h9.5v9.5H9z" />
      <path d="M6 15V6h9" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  moon: <path d="M19 14.6A7.5 7.5 0 0 1 9.4 5a8.5 8.5 0 1 0 9.6 9.6z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3" />
      <path d="M12 19.2v2.3" />
      <path d="M4.9 4.9l1.6 1.6" />
      <path d="M17.5 17.5l1.6 1.6" />
      <path d="M2.5 12h2.3" />
      <path d="M19.2 12h2.3" />
      <path d="M4.9 19.1l1.6-1.6" />
      <path d="M17.5 6.5l1.6-1.6" />
    </>
  ),
}

export function Icon({ name, size = 18, ...props }: IconProps) {
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
      {iconPaths[name]}
    </svg>
  )
}
