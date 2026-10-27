import { useEffect, useId, useRef, useState } from 'react'
import { FloatingMenu } from '../../../design-system/primitives/FloatingMenu'
import { Icon } from '../../../design-system/primitives/Icon'
import { getNodeVisualMetadata } from '../queries/workspaceDirectory'
import styles from './WorkspaceSelectDropdown.module.css'

export type WorkspaceSelectOption = {
  nodeId: number
  nodeName: string
  nodeType?: string
}

export type WorkspaceSelectDropdownProps = {
  options: WorkspaceSelectOption[]
  value: number | null
  onChange: (nodeId: number) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}

export function WorkspaceSelectDropdown({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = '워크스페이스를 선택하세요',
  ariaLabel = '워크스페이스 선택',
}: WorkspaceSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listboxId = useId()
  const selectedOption = options.find((option) => option.nodeId === value)
  const isDisabled = disabled || options.length === 0

  useEffect(() => {
    if (isDisabled) {
      setIsOpen(false)
    }
  }, [isDisabled])

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={[styles.trigger, isOpen ? styles.triggerOpen : ''].filter(Boolean).join(' ')}
        disabled={isDisabled}
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
      >
        <span className={styles.selected}>
          {selectedOption ? (
            <>
              <Icon
                name={getNodeVisualMetadata(selectedOption.nodeType ?? '').iconName}
                size={15}
                className={styles.workspaceIcon}
              />
              <span className={styles.selectedText}>{selectedOption.nodeName}</span>
              {selectedOption.nodeType ? (
                <span className={styles.typeBadge}>[{selectedOption.nodeType}]</span>
              ) : null}
            </>
          ) : (
            <>
              <Icon name="folder" size={15} className={styles.workspaceIcon} />
              <span className={styles.placeholder}>{placeholder}</span>
            </>
          )}
        </span>
        <Icon
          name="chevronDown"
          size={14}
          className={[styles.chevron, isOpen ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
        />
      </button>

      <FloatingMenu
        anchorRef={triggerRef}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className={styles.menu}
        maxHeight={280}
      >
        <div id={listboxId} className={styles.menuList} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const isSelected = option.nodeId === value

            return (
              <button
                key={option.nodeId}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={[styles.option, isSelected ? styles.optionSelected : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onChange(option.nodeId)
                  setIsOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <Icon
                  name={getNodeVisualMetadata(option.nodeType ?? '').iconName}
                  size={15}
                  className={styles.workspaceIcon}
                />
                <span className={styles.optionText}>{option.nodeName}</span>
                {option.nodeType ? (
                  <span className={styles.typeBadge}>[{option.nodeType}]</span>
                ) : null}
                {isSelected ? <Icon name="checkCircle" size={14} className={styles.checkIcon} /> : null}
              </button>
            )
          })}
        </div>
      </FloatingMenu>
    </div>
  )
}
