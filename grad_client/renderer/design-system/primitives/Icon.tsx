import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'database'
  | 'folder'
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
  | 'arrowRight'
  | 'chevronLeft'
  | 'chevronRight'
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
    <>
      <path d="M4 6.5h6l2 2h8v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 8.5V7a2 2 0 0 1 2-2h3.2l2 2H18a2 2 0 0 1 2 2v1" />
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
      <path
        d="M220.17,100,202.86,70a28,28,0,0,0-38.24-10.25,27.69,27.69,0,0,0-9,8.34L138.2,38a28,28,0,0,0-48.48,0A28,28,0,0,0,48.15,74l1.59,2.76A27.67,27.67,0,0,0,38,80.41a28,28,0,0,0-10.24,38.25l40,69.32a87.47,87.47,0,0,0,53.43,41,88.56,88.56,0,0,0,22.92,3,88,88,0,0,0,76.06-132Zm-6.66,62.64A72,72,0,0,1,81.62,180l-40-69.32a12,12,0,0,1,20.78-12L81.63,132a8,8,0,1,0,13.85-8L62,66A12,12,0,1,1,82.78,54L114,108a8,8,0,1,0,13.85-8L103.57,58h0a12,12,0,1,1,20.78-12l33.42,57.9a48,48,0,0,0-5.54,60.6,8,8,0,0,0,13.24-9A32,32,0,0,1,172.78,112a8,8,0,0,0,2.13-10.4L168.23,90A12,12,0,1,1,189,78l17.31,30A71.56,71.56,0,0,1,213.51,162.62ZM184.25,31.71A8,8,0,0,1,194,26a59.62,59.62,0,0,1,36.53,28l.33.57a8,8,0,1,1-13.85,8l-.33-.57a43.67,43.67,0,0,0-26.8-20.5A8,8,0,0,1,184.25,31.71ZM80.89,237a8,8,0,0,1-11.23,1.33A119.56,119.56,0,0,1,40.06,204a8,8,0,0,1,13.86-8,103.67,103.67,0,0,0,25.64,29.72A8,8,0,0,1,80.89,237Z"
        fill="currentColor"
        stroke="none"
        transform="scale(0.09375)"
      />
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
  fileText: (
    <>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5z" />
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
  arrowRight: <path d="M5 12h13M13 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
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
