import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'database'
  | 'folder'
  | 'mail'
  | 'lock'
  | 'eye'
  | 'eyeOff'
  | 'globe'
  | 'building'
  | 'orgChart'
  | 'list'
  | 'star'
  | 'cube'
  | 'pencil'
  | 'dollarSign'
  | 'flask'
  | 'megaphone'
  | 'moreHorizontal'
  | 'search'
  | 'bell'
  | 'helpCircle'
  | 'user'
  | 'hand'
  | 'calendar'
  | 'clock'
  | 'checkCircle'
  | 'checkSquare'
  | 'alertTriangle'
  | 'sparkles'
  | 'page'
  | 'fileText'
  | 'plus'
  | 'users'
  | 'messageCircle'
  | 'trendingUp'
  | 'lineChart'
  | 'arrowRight'
  | 'firstPage'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronUp'
  | 'chevronDown'
  | 'logOut'
  | 'gear'
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
  folder: (
    <path d="M4 6a2 2 0 0 1 2-2h3.2l2 2H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 5.5L20 7" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5V17" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6S18 18 12 18s-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.7 6.1A10.2 10.2 0 0 1 12 6c6 0 9.5 6 9.5 6a13.6 13.6 0 0 1-2.2 3" />
      <path d="M16.9 17.1A9.7 9.7 0 0 1 12 18c-6 0-9.5-6-9.5-6a14.5 14.5 0 0 1 3.2-3.8" />
      <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.6 14.6 0 0 1 0 18" />
      <path d="M12 3a14.6 14.6 0 0 0 0 18" />
    </>
  ),
  building: (
    <>
      <path d="M5 21V5.8a1.8 1.8 0 0 1 1.8-1.8h7.4A1.8 1.8 0 0 1 16 5.8V21" />
      <path d="M16 9h2.2a1.8 1.8 0 0 1 1.8 1.8V21" />
      <path d="M3 21h18" />
      <path d="M8 8h1M12 8h1M8 12h1M12 12h1M8 16h1M12 16h1M17.5 13h.5M17.5 17h.5" />
    </>
  ),
  orgChart: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  star: <path d="m12 3 2.75 5.58 6.16.9-4.46 4.34 1.05 6.13L12 17.05l-5.5 2.9 1.05-6.13-4.46-4.34 6.16-.9L12 3z" />,
  cube: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12.1V21" />
    </>
  ),
  pencil: (
    <>
      <path d="m5 19 1.2-4.6L16.4 4.2a1.7 1.7 0 0 1 2.4 0l1 1a1.7 1.7 0 0 1 0 2.4L9.6 17.8 5 19z" />
      <path d="m14.8 5.8 3.4 3.4M6.2 14.4l3.4 3.4" />
    </>
  ),
  dollarSign: (
    <>
      <path d="M12 3v18" />
      <path d="M16.5 6.5H9.8a3.3 3.3 0 0 0 0 6.5h4.4a3.3 3.3 0 0 1 0 6.5H7.5" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6.2L5.2 18a2 2 0 0 0 1.75 3h10.1a2 2 0 0 0 1.75-3L14 9.2V3" />
      <path d="M7.3 16h9.4" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 11v3a2 2 0 0 0 2 2h2l8 4V5L8 9H6a2 2 0 0 0-2 2z" />
      <path d="M8 16l1 5h3l-1-3.5M19 9a4 4 0 0 1 0 7" />
    </>
  ),
  moreHorizontal: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0v3.2l1.7 3.1H4.8l1.7-3.1V10z" />
      <path d="M9.5 19a2.7 2.7 0 0 0 5 0" />
    </>
  ),
  helpCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.7 9.2a2.5 2.5 0 1 1 3.9 2.1c-.9.6-1.6 1.1-1.6 2.2" />
      <path d="M12 17h.01" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  hand: (
    <>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v7" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2l-3.3-3.3a2 2 0 0 1 2.8-2.8L7 15.4" />
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
  checkSquare: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.8" />
      <path d="M8.2 12.1l2.4 2.4 5.2-5.4" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 9v4.2" />
      <path d="M12 17h.01" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" />
      <path d="m18.5 13.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
      <path d="m5.5 13.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </>
  ),
  page: (
    <>
      <path d="M7.5 3.5H14l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12h6" />
      <path d="M9 15.5h6" />
    </>
  ),
  fileText: (
    <>
      <path d="M7.5 3.5H14l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 11.5h6" />
      <path d="M9 15h6" />
      <path d="M9 18.5h4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.8 20a5.2 5.2 0 0 1 10.4 0" />
      <path d="M15.5 6.2a3 3 0 0 1 0 5.6" />
      <path d="M16.5 15.2A5.2 5.2 0 0 1 20.2 20" />
    </>
  ),
  messageCircle: (
    <>
      <path d="M4.5 6.8A8.2 8.2 0 0 1 12 3.5c4.7 0 8.5 3.2 8.5 7.3S16.7 18 12 18a10 10 0 0 1-2.4-.3L5 20.5l1-4A7 7 0 0 1 4.5 6.8z" />
    </>
  ),
  trendingUp: (
    <>
      <path d="M4 16l5-5 4 4 7-8" />
      <path d="M15 7h5v5" />
    </>
  ),
  lineChart: (
    <>
      <path d="M4 19h16" />
      <path d="M5 14l5-5 4 4 6-6" />
      <path d="M15 7h5v5" />
    </>
  ),
  arrowRight: <path d="M5 12h13M13 6l6 6-6 6" />,
  firstPage: (
    <>
      <path d="M6 5v14" />
      <path d="M17 6l-6 6 6 6" />
    </>
  ),
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  logOut: (
    <>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M13 8l4 4-4 4" />
      <path d="M8 12h9" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.5-2.4 1a8.2 8.2 0 0 0-2.6-1.5L14 2.5h-4L9.6 5a8.2 8.2 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8.2 8.2 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8.2 8.2 0 0 0 2.6-1.5l2.4 1 2-3.5z" />
    </>
  ),
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

export function Icon({ name, size = 18, style, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto', maxWidth: 'none', ...style }}
      {...props}
    >
      {iconPaths[name]}
    </svg>
  )
}
