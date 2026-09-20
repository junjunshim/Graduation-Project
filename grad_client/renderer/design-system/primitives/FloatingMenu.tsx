import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

export type FloatingMenuProps = {
  /** 위치 계산 기준이 되는 트리거 요소 */
  anchorRef: RefObject<HTMLElement | null>
  isOpen: boolean
  onClose: () => void
  /** 메뉴 표면 스타일(배경/테두리/패딩 등) 클래스 */
  className?: string
  /** 메뉴 최대 높이(px). 남은 공간이 더 좁으면 그만큼 줄인다. */
  maxHeight?: number
  /** 트리거와 메뉴 사이 간격(px) */
  offset?: number
  zIndex?: number
  children: ReactNode
}

/**
 * 부모의 overflow(모달 본문 스크롤 등)에 잘리지 않도록 body 로 포탈 렌더링하는 드롭다운 메뉴.
 * 위치는 트리거의 화면 좌표를 기준으로 계산하고, 아래 공간이 부족하면 위로 뒤집어 띄운다.
 */
export function FloatingMenu({
  anchorRef,
  isOpen,
  onClose,
  className,
  maxHeight = 280,
  offset = 6,
  zIndex = 1200,
  children,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)

  const reposition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    // 렌더 전(첫 계산)에는 아직 높이를 알 수 없으므로 최대 높이로 가정한다.
    const menuHeight = Math.min(menuRef.current?.offsetHeight || maxHeight, maxHeight)
    const roomBelow = window.innerHeight - rect.bottom - offset - 8
    const roomAbove = rect.top - offset - 8
    const openUpwards = roomBelow < menuHeight && roomAbove > roomBelow
    const available = Math.max(120, openUpwards ? roomAbove : roomBelow)

    setStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      top: openUpwards ? rect.top - Math.min(menuHeight, available) - offset : rect.bottom + offset,
      maxHeight: Math.min(menuHeight, available),
      zIndex,
    })
  }, [anchorRef, maxHeight, offset, zIndex])

  // 열릴 때 위치를 계산하고, 실제 렌더 높이를 반영해 다음 프레임에 한 번 더 보정한다.
  useEffect(() => {
    if (!isOpen) {
      setStyle(null)
      return
    }

    reposition()
    const frame = requestAnimationFrame(reposition)
    return () => cancelAnimationFrame(frame)
  }, [isOpen, reposition])

  // 열려 있는 동안: 바깥 클릭·ESC 로 닫고, 스크롤/리사이즈 시 위치가 어긋나므로 닫는다.
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onClose()
      anchorRef.current?.focus()
    }

    const handleViewportChange = (event: Event) => {
      // 메뉴 내부 스크롤은 무시한다.
      if (event.type === 'scroll' && menuRef.current?.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [anchorRef, isOpen, onClose])

  if (!isOpen || !style) return null

  return createPortal(
    <div ref={menuRef} className={className} style={style}>
      {children}
    </div>,
    document.body,
  )
}