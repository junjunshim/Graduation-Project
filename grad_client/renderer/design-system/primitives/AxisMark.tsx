import type { ImgHTMLAttributes } from 'react'

import axisBeigeUrl from '../assets/theme-logos/axis-beige.webp'
import axisDarkUrl from '../assets/theme-logos/axis-dark.webp'
import axisNavyUrl from '../assets/theme-logos/axis-navy.webp'
import axisWhiteUrl from '../assets/theme-logos/axis-white.webp'
import type { ThemeMode } from '../theme/ThemeContext'
import { useTheme } from '../theme/ThemeContext'

const AXIS_MARK_URLS: Record<ThemeMode, string> = {
  white: axisWhiteUrl,
  beige: axisBeigeUrl,
  dark: axisDarkUrl,
  navy: axisNavyUrl,
}

type AxisMarkProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'alt' | 'children' | 'height' | 'src' | 'width'
> & {
  size?: number
}

export function AxisMark({ size = 44, style, ...props }: AxisMarkProps) {
  const { themeMode } = useTheme()

  return (
    <img
      {...props}
      src={AXIS_MARK_URLS[themeMode]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{
        display: 'block',
        flex: '0 0 auto',
        maxWidth: 'none',
        objectFit: 'contain',
        pointerEvents: 'none',
        userSelect: 'none',
        ...style,
      }}
    />
  )
}
