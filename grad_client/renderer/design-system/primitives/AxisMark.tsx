import type { ImgHTMLAttributes } from 'react'

import axisMarkUrl from '../assets/axis-mark.png'

type AxisMarkProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'alt' | 'children' | 'height' | 'src' | 'width'
> & {
  size?: number
}

export function AxisMark({ size = 44, style, ...props }: AxisMarkProps) {
  return (
    <img
      {...props}
      src={axisMarkUrl}
      width={size * 1.2}
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
