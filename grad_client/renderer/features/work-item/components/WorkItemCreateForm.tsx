import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { getNodeVisualMetadata } from '../../workspace/queries/workspaceDirectory'
import { getCategoryBadgeStyle, getWorkItemStatusLabel } from '../../workspace/model/labels'
import { getWorkItemDisplayCode } from '../../workspace/model/formatters'
import { WORK_ITEM_STATUS_OPTIONS } from '../../workspace/model/options'
import type { WorkItemComposerContext } from '../../workspace/model/types'
import { DatePicker } from '../../../design-system/primitives/DatePicker'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemCreateFormProps = {
  composer: WorkItemComposerContext
  form: WorkItemCreateFormState
  submitting: boolean
  feedback: { tone: 'error' | 'success'; message: string } | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  submitLabel?: string
  submittingLabel?: string
  categoryRequired?: boolean
  categorySupported?: boolean
  dueDateRequired?: boolean
  ownerLocked?: boolean
  submitDisabled?: boolean
  onFieldChange: <Key extends keyof WorkItemCreateFormState>(
    field: Key,
    value: WorkItemCreateFormState[Key],
  ) => void
}

const priorityOptions = [
  { value: '1', symbol: '↑↑', label: '매우 높음', tone: 'highest' },
  { value: '2', symbol: '↑', label: '높음', tone: 'high' },
  { value: '3', symbol: '−', label: '보통', tone: 'medium' },
  { value: '4', symbol: '↓', label: '낮음', tone: 'low' },
  { value: '5', symbol: '↓↓', label: '매우 낮음', tone: 'lowest' },
] as const

export function WorkItemCreateForm({
  composer,
  form,
  submitting,
  feedback,
  onSubmit,
  onCancel,
  submitLabel = '업무 등록하기',
  submittingLabel = '등록 중...',
  categoryRequired = false,
  categorySupported = true,
  dueDateRequired = false,
  ownerLocked = false,
  submitDisabled = false,
  onFieldChange,
}: WorkItemCreateFormProps) {
  const [isNodeDropdownOpen, setIsNodeDropdownOpen] = useState(false)
  const [isParentDropdownOpen, setIsParentDropdownOpen] = useState(false)
  const parentDropdownId = useId()
  const parentDropdownRef = useRef<HTMLDivElement | null>(null)
  const parentTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false)
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false)
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false)
  const nodeDropdownRef = useRef<HTMLDivElement | null>(null)
  const userDropdownRef = useRef<HTMLDivElement | null>(null)
  const categoryDropdownRef = useRef<HTMLDivElement | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const titleErrorId = useId()

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (parentDropdownRef.current && !parentDropdownRef.current.contains(event.target as Node)) {
        setIsParentDropdownOpen(false)
      }
      if (
        nodeDropdownRef.current &&
        !nodeDropdownRef.current.contains(event.target as Node)
      ) {
        setIsNodeDropdownOpen(false)
      }
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(event.target as Node)
      ) {
        setIsUserDropdownOpen(false)
      }
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCategoryDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isParentDropdownOpen) {
      parentDropdownRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    }
  }, [isParentDropdownOpen])

  const parentOptions = [
    { value: '', label: '(최상위 업무 - 상위 업무 없음)' },
    ...composer.availableParentItems.map((parent) => ({
      value: parent.workItemId,
      label: `${parent.hidden ? '🔒 [숨김] ' : ''}[${getWorkItemDisplayCode(parent)}] ${parent.title}`,
    })),
  ]
  const selectedParent = parentOptions.find((option) => option.value === form.parentWorkItemId)

  const selectedNodeObj = composer.availableNodes.find(
    (n) => String(n.id) === form.ownerNodeId,
  )

  const selectedUserObj = composer.assignableUsers.find(
    (u) => u.userId === form.ownerUserId,
  )

  // 동적 카테고리 목록: 해당 조직(노드)에서 실제 사용 중인 카테고리 목록만 사용
  const allCategoryOptions = Array.from(
    new Set(composer.existingCategories || []),
  ).sort((a, b) => a.localeCompare(b, 'ko'))

  const isCustomCategory = Boolean(
    form.categoryId && !allCategoryOptions.includes(form.categoryId),
  )

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    if (!form.title.trim()) {
      event.preventDefault()
      setTitleError('업무 제목을 입력해 주세요.')
      titleInputRef.current?.focus()
      return
    }

    setTitleError(null)
    onSubmit(event)
  }

  return (
    <form className={styles.form} onSubmit={handleFormSubmit} noValidate>
      {/* 1. 기본 정보 및 배정 카드 */}
      <section className={styles.cardSection}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>📋</div>
          <div>
            <h3 className={styles.cardTitle}>기본 정보 및 배정</h3>
            <p className={styles.cardSubtitle}>업무의 핵심 내용과 업무를 수행할 조직 및 담당자를 지정합니다.</p>
          </div>
        </div>

        <div className={styles.cardBody}>
          {/* 업무 제목 */}
          <label className={styles.fieldFull}>
            <span className={styles.fieldLabel}>업무 제목 <i className={styles.required}>*</i></span>
            <input
              ref={titleInputRef}
              type="text"
              className={[styles.textInput, titleError ? styles.textInputInvalid : ''].filter(Boolean).join(' ')}
              value={form.title}
              onChange={(event) => {
                onFieldChange('title', event.target.value)

                if (titleError && event.target.value.trim()) {
                  setTitleError(null)
                }
              }}
              placeholder="예: 2분기 프론트엔드 성능 최적화 및 접근성 개선"
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? titleErrorId : undefined}
              required
              autoFocus
            />
            {titleError ? (
              <span className={styles.fieldError} id={titleErrorId} role="alert">
                <Icon name="alertTriangle" size={13} />
                {titleError}
              </span>
            ) : null}
          </label>

          {/* 담당 조직 선택 및 상위 업무 선택 */}
          <div className={styles.fieldGridTwo} style={{ position: 'relative', zIndex: (isNodeDropdownOpen || isParentDropdownOpen) ? 30 : 20 }}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                담당 조직 (노드) <i className={styles.required}>*</i>
              </span>
              <div
                ref={nodeDropdownRef}
                className={[
                  styles.customDropdownContainer,
                  isNodeDropdownOpen ? styles.customDropdownContainerOpen : '',
                ].join(' ')}
              >
                <button
                  type="button"
                  className={[
                    styles.workspaceDropdownTrigger,
                    isNodeDropdownOpen ? styles.workspaceDropdownTriggerOpen : '',
                  ].join(' ')}
                  onClick={() => setIsNodeDropdownOpen((prev) => !prev)}
                  aria-expanded={isNodeDropdownOpen}
                  aria-haspopup="listbox"
                >
                  <div className={styles.workspaceSelectedDisplay}>
                    {selectedNodeObj ? (
                      <>
                        <Icon
                          name={getNodeVisualMetadata(selectedNodeObj.nodeType).iconName}
                          size={15}
                          className={styles.workspaceIcon}
                        />
                        <span className={styles.workspaceSelectedText}>{selectedNodeObj.name}</span>
                        <span className={styles.workspaceItemTypeBadge}>[{selectedNodeObj.nodeType}]</span>
                      </>
                    ) : (
                      <>
                        <Icon name="folder" size={15} className={styles.workspaceIcon} />
                        <span className={styles.workspacePlaceholder}>조직을 선택하세요</span>
                      </>
                    )}
                  </div>
                  <Icon
                    name="chevronDown"
                    size={14}
                    className={isNodeDropdownOpen ? styles.rotateChevron : undefined}
                  />
                </button>

                {isNodeDropdownOpen && (
                  <div className={styles.workspaceDropdownMenu} role="listbox">
                    {composer.availableNodes.map((node) => {
                      const isSelected = String(node.id) === form.ownerNodeId
                      return (
                        <button
                          key={node.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={[
                            styles.workspaceDropdownItem,
                            isSelected ? styles.workspaceDropdownItemSelected : '',
                          ].join(' ')}
                          onClick={() => {
                            onFieldChange('ownerNodeId', String(node.id))
                            setIsNodeDropdownOpen(false)
                          }}
                        >
                          <Icon
                            name={getNodeVisualMetadata(node.nodeType).iconName}
                            size={15}
                            className={styles.workspaceIcon}
                          />
                          <span className={styles.workspaceItemText}>{node.name}</span>
                          <span className={styles.workspaceItemTypeBadge}>[{node.nodeType}]</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <span className={styles.fieldHelpText}>
                상속된 권한을 포함해 업무 생성 권한이 있는 {composer.availableNodes.length}개 조직 중 선택 가능합니다.
              </span>
            </div>

            <div className={styles.field}>
              <span id={`${parentDropdownId}-label`} className={styles.fieldLabel}>상위 업무 (Parent WorkItem)</span>
              <div
                ref={parentDropdownRef}
                className={[
                  styles.customDropdownContainer,
                  isParentDropdownOpen ? styles.customDropdownContainerOpen : '',
                ].join(' ')}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setIsParentDropdownOpen(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setIsParentDropdownOpen(false)
                    parentTriggerRef.current?.focus()
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    if (!isParentDropdownOpen) {
                      setIsParentDropdownOpen(true)
                      return
                    }
                    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
                    const index = options.findIndex((option) => option === document.activeElement)
                    options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
                  }
                }}
              >
                <button
                  ref={parentTriggerRef}
                  type="button"
                  className={[
                    styles.workspaceDropdownTrigger,
                    isParentDropdownOpen ? styles.workspaceDropdownTriggerOpen : '',
                  ].join(' ')}
                  onClick={() => setIsParentDropdownOpen((prev) => !prev)}
                  aria-labelledby={`${parentDropdownId}-label ${parentDropdownId}-value`}
                  aria-expanded={isParentDropdownOpen}
                  aria-haspopup="listbox"
                  aria-controls={isParentDropdownOpen ? parentDropdownId : undefined}
                >
                  <span className={styles.workspaceSelectedDisplay}>
                    <span id={`${parentDropdownId}-value`} className={selectedParent?.value ? styles.workspaceSelectedText : styles.workspacePlaceholder}>
                      {selectedParent?.label ?? parentOptions[0].label}
                    </span>
                  </span>
                  <Icon name="chevronDown" size={14} className={isParentDropdownOpen ? styles.rotateChevron : undefined} />
                </button>
                {isParentDropdownOpen && (
                  <div id={parentDropdownId} className={styles.workspaceDropdownMenu} role="listbox" aria-labelledby={`${parentDropdownId}-label`}>
                    {parentOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={option.value === form.parentWorkItemId}
                        className={[
                          styles.workspaceDropdownItem,
                          option.value === form.parentWorkItemId ? styles.workspaceDropdownItemSelected : '',
                        ].join(' ')}
                        title={option.label}
                        onClick={() => {
                          onFieldChange('parentWorkItemId', option.value)
                          setIsParentDropdownOpen(false)
                          parentTriggerRef.current?.focus()
                        }}
                      >
                        <span className={styles.workspaceItemText}>{option.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className={styles.fieldHelpText}>
                담당 노드 및 직속 부모 노드의 업무까지만 선택할 수 있습니다.
              </span>
            </div>
          </div>

          {/* 담당자 배정 및 업무 카테고리 */}
          <div className={styles.fieldGridTwo} style={{ position: 'relative', zIndex: (isUserDropdownOpen || isCategoryDropdownOpen) ? 30 : 10 }}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                담당자 배정 {!ownerLocked ? <i className={styles.required}>*</i> : null}
                {form.hidden ? <span className={styles.hiddenAssigneeTag}>🔒 숨김 권한자 전용</span> : null}
              </span>

              <div
                ref={userDropdownRef}
                className={[
                  styles.customDropdownContainer,
                  isUserDropdownOpen ? styles.customDropdownContainerOpen : '',
                ].join(' ')}
              >
                <button
                  type="button"
                  className={[
                    styles.workspaceDropdownTrigger,
                    isUserDropdownOpen ? styles.workspaceDropdownTriggerOpen : '',
                  ].join(' ')}
                  onClick={() => {
                    if (!ownerLocked) {
                      setIsUserDropdownOpen((prev) => !prev)
                    }
                  }}
                  disabled={ownerLocked}
                  aria-expanded={isUserDropdownOpen}
                  aria-haspopup="listbox"
                >
                  <div className={styles.userSelectedDisplay}>
                    {selectedUserObj ? (
                      <>
                        <Icon name="user" size={15} className={styles.workspaceIcon} />
                        <span className={styles.userSelectedText}>
                          <strong>{selectedUserObj.name}</strong>
                          <span className={styles.userSelectedEmail}>
                            ({selectedUserObj.email || selectedUserObj.userId})
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <Icon name="user" size={15} className={styles.workspaceIcon} />
                        <span className={styles.workspacePlaceholder}>담당자를 선택하세요</span>
                      </>
                    )}
                  </div>
                  {!ownerLocked ? (
                    <Icon
                      name="chevronDown"
                      size={14}
                      className={isUserDropdownOpen ? styles.rotateChevron : undefined}
                    />
                  ) : null}
                </button>

                {isUserDropdownOpen && !ownerLocked && (
                  <div className={styles.workspaceDropdownMenu} role="listbox">
                    {composer.assignableUsers.map((user) => {
                      const isSelected = user.userId === form.ownerUserId
                      return (
                        <button
                          key={user.userId}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={[
                            styles.workspaceDropdownItem,
                            isSelected ? styles.workspaceDropdownItemSelected : '',
                          ].join(' ')}
                          onClick={() => {
                            onFieldChange('ownerUserId', user.userId)
                            setIsUserDropdownOpen(false)
                          }}
                        >
                          <Icon name="user" size={15} className={styles.workspaceIcon} />
                          <div className={styles.userItemInfo}>
                            <span className={styles.userNameText}>{user.name}</span>
                            <span className={styles.userEmailText}>{user.email || user.userId}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <span className={styles.fieldHelpText}>
                {form.hidden
                  ? `숨김 업무 권한을 보유한 ${composer.assignableUsers.length}명의 팀원 중 지정합니다.`
                  : `선택한 조직에 배속된 ${composer.assignableUsers.length}명의 팀원 중 지정합니다.`}
              </span>
            </div>

            {categorySupported ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>
                  카테고리 (Category) {categoryRequired ? <i className={styles.required}>*</i> : null}
                </span>

                <div
                  ref={categoryDropdownRef}
                  className={[
                    styles.customDropdownContainer,
                    isCategoryDropdownOpen ? styles.customDropdownContainerOpen : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    className={[
                      styles.workspaceDropdownTrigger,
                      isCategoryDropdownOpen ? styles.workspaceDropdownTriggerOpen : '',
                    ].join(' ')}
                    onClick={() => setIsCategoryDropdownOpen((prev) => !prev)}
                    aria-expanded={isCategoryDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    <div className={styles.workspaceSelectedDisplay}>
                      {form.categoryId ? (
                        <span
                          className={styles.categoryBadge}
                          style={getCategoryBadgeStyle(form.categoryId)}
                        >
                          {form.categoryId}
                        </span>
                      ) : (
                        <span className={styles.categoryPlaceholder}>카테고리 선택 (선택 안 함)</span>
                      )}
                    </div>
                    <Icon
                      name="chevronDown"
                      size={14}
                      className={isCategoryDropdownOpen ? styles.rotateChevron : undefined}
                    />
                  </button>

                  {isCategoryDropdownOpen && (
                    <div className={styles.workspaceDropdownMenu} role="listbox">
                      <button
                        type="button"
                        role="option"
                        aria-selected={form.categoryId === ''}
                        className={[
                          styles.workspaceDropdownItem,
                          form.categoryId === '' ? styles.workspaceDropdownItemSelected : '',
                        ].join(' ')}
                        onClick={() => {
                          setIsCustomCategoryMode(false)
                          onFieldChange('categoryId', '')
                          setIsCategoryDropdownOpen(false)
                        }}
                      >
                        <span className={styles.workspaceItemText}>카테고리 없음 (선택 안 함)</span>
                      </button>

                      {allCategoryOptions.map((cat) => {
                        const isSelected = form.categoryId === cat
                        return (
                          <button
                            key={cat}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={[
                              styles.workspaceDropdownItem,
                              isSelected ? styles.workspaceDropdownItemSelected : '',
                            ].join(' ')}
                            onClick={() => {
                              setIsCustomCategoryMode(false)
                              onFieldChange('categoryId', cat)
                              setIsCategoryDropdownOpen(false)
                            }}
                          >
                            <span
                              className={styles.categoryBadge}
                              style={getCategoryBadgeStyle(cat)}
                            >
                              {cat}
                            </span>
                          </button>
                        )
                      })}

                      <button
                        type="button"
                        role="option"
                        aria-selected={isCustomCategoryMode || isCustomCategory}
                        className={[
                          styles.workspaceDropdownItem,
                          (isCustomCategoryMode || isCustomCategory) ? styles.workspaceDropdownItemSelected : '',
                        ].join(' ')}
                        onClick={() => {
                          setIsCustomCategoryMode(true)
                          setIsCategoryDropdownOpen(false)
                        }}
                      >
                        <Icon name="pencil" size={14} className={styles.workspaceIcon} />
                        <span className={styles.workspaceItemText}>직접 입력...</span>
                      </button>
                    </div>
                  )}
                </div>

                {(isCustomCategoryMode || isCustomCategory) ? (
                  <div className={styles.customInputRow}>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={form.categoryId}
                      onChange={(event) => onFieldChange('categoryId', event.target.value)}
                      placeholder="새 카테고리명을 직접 입력하세요"
                      autoFocus
                    />
                    <button
                      type="button"
                      className={styles.customInputResetBtn}
                      onClick={() => {
                        setIsCustomCategoryMode(false)
                        onFieldChange('categoryId', '')
                      }}
                    >
                      취소
                    </button>
                  </div>
                ) : null}

                <span className={styles.fieldHelpText}>
                  조직 내 기존 카테고리를 선택하거나 새로운 카테고리를 직접 입력할 수 있습니다.
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* 2. 속성 및 일정 카드 */}
      <section className={styles.cardSection}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>⚙️</div>
          <div>
            <h3 className={styles.cardTitle}>속성 및 일정</h3>
            <p className={styles.cardSubtitle}>업무의 우선순위, 진행 상태, 일정 범위 및 공개 여부를 설정합니다.</p>
          </div>
        </div>

        <div className={styles.cardBody}>
          {/* 상태 및 우선순위 */}
          <div className={styles.fieldGridTwo}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>진행 상태 <i className={styles.required}>*</i></span>
              <div className={styles.statusButtonGroup}>
                {WORK_ITEM_STATUS_OPTIONS.map((status) => {
                  const isSelected = form.status === status
                  return (
                    <button
                      key={status}
                      type="button"
                      className={[
                        styles.statusButton,
                        isSelected ? styles.statusButtonSelected : '',
                      ].filter(Boolean).join(' ')}
                      data-status={status}
                      onClick={() => onFieldChange('status', status)}
                    >
                      <span className={styles.statusIndicator} data-status={status} />
                      {getWorkItemStatusLabel(status)}
                    </button>
                  )
                })}
              </div>
            </label>

            <fieldset className={styles.priorityFieldset}>
              <legend className={styles.fieldLabel}>우선순위 <i className={styles.required}>*</i></legend>
              <div className={styles.priorityGrid}>
                {priorityOptions.map((option) => {
                  const isSelected = form.priority === option.value
                  return (
                    <label
                      key={option.value}
                      className={[
                        styles.priorityPill,
                        isSelected ? styles.priorityPillSelected : '',
                      ].filter(Boolean).join(' ')}
                      data-tone={option.tone}
                    >
                      <input
                        type="radio"
                        name="priority"
                        value={option.value}
                        checked={isSelected}
                        onChange={(event) => onFieldChange('priority', event.target.value)}
                        className={styles.visuallyHidden}
                      />
                      <span className={styles.prioritySymbol}>{option.symbol}</span>
                      <span className={styles.priorityText}>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          </div>

          {/* 일정 (시작일, 마감일) */}
          <div className={styles.fieldGridTwo}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>시작일 (Start Date)</span>
              <DatePicker
                label="시작일"
                value={form.startDate}
                onChange={(nextValue) => onFieldChange('startDate', nextValue)}
                maxDate={form.dueDate || undefined}
              />
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>마감일 (Due Date) {dueDateRequired ? <i className={styles.required}>*</i> : null}</span>
              <DatePicker
                label="마감일"
                value={form.dueDate}
                onChange={(nextValue) => onFieldChange('dueDate', nextValue)}
                minDate={form.startDate || undefined}
              />
            </div>
          </div>

          {/* 가중치 및 진행률 */}
          <div className={styles.fieldGridTwo}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>가중치 (Weight)</span>
              <input
                type="number"
                min="1"
                max="100"
                className={styles.textInput}
                value={form.weight}
                onChange={(event) => {
                  const raw = event.target.value

                  if (raw === '') {
                    onFieldChange('weight', '')
                    return
                  }

                  const clampedWeight = Math.min(100, Math.max(1, Number(raw)))

                  if (!Number.isNaN(clampedWeight)) {
                    onFieldChange('weight', String(clampedWeight))
                  }
                }}
              />
              <span className={styles.fieldHelpText}>업무의 상대적 비중(기본: 1)</span>
            </label>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>초기 진행률 ({form.progress}%)</span>
              <div className={styles.sliderRow}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  className={styles.rangeSlider}
                  value={form.progress}
                  onChange={(event) => onFieldChange('progress', event.target.value)}
                />
                <div className={styles.progressInputWrapper}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className={styles.progressNumberInput}
                    value={form.progress}
                    onChange={(event) => {
                      const raw = event.target.value
                      if (raw === '') {
                        onFieldChange('progress', '0')
                        return
                      }
                      const num = Math.min(100, Math.max(0, Number(raw)))
                      if (!Number.isNaN(num)) {
                        onFieldChange('progress', String(num))
                      }
                    }}
                  />
                  <span className={styles.progressUnit}>%</span>
                </div>
              </div>
            </div>
          </div>

          {/* 숨김(비공개) 속성 옵션 */}
          <div className={styles.fieldFull}>
            <label className={styles.toggleCard}>
              <div className={styles.toggleContent}>
                <div className={styles.toggleTitleRow}>
                  <span className={styles.toggleIcon}>🔒</span>
                  <strong className={styles.toggleTitle}>숨김 업무(비공개)로 등록</strong>
                  {form.hidden ? (
                    <span className={styles.toggleBadgeHidden}>숨김 적용됨</span>
                  ) : (
                    <span className={styles.toggleBadgePublic}>일반 공개</span>
                  )}
                </div>
                <p className={styles.toggleDescription}>
                  체크 시 해당 노드의 숨김 업무 조회 권한(<code>WI_HIDDEN_VIEW</code>)이 있는 인원에게만 노출되며, 일반 구성원 목록 및 피드에서 숨겨집니다.
                </p>
              </div>
              <div className={styles.toggleSwitchWrapper}>
                <input
                  type="checkbox"
                  className={styles.toggleCheckbox}
                  checked={form.hidden}
                  onChange={(event) => onFieldChange('hidden', event.target.checked)}
                />
                <span className={styles.toggleSwitchSlider} />
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* 3. 상세 내용 & 첨부파일 카드 */}
      <section className={styles.cardSection}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderIcon}>📝</div>
          <div>
            <h3 className={styles.cardTitle}>상세 내용 및 자료</h3>
            <p className={styles.cardSubtitle}>업무에 필요한 요구사항 명세서, 배경 정보 및 참고자료를 입력합니다.</p>
          </div>
        </div>

        <div className={styles.cardBody}>
          <label className={styles.fieldFull}>
            <span className={styles.fieldLabel}>업무 설명 (Description)</span>
            <textarea
              className={styles.textareaInput}
              rows={6}
              value={form.description}
              onChange={(event) => onFieldChange('description', event.target.value)}
              placeholder="업무 목표, 세부 요구사항, 완료 기준(Definition of Done), 참고 링크 등을 상세히 작성하세요."
            />
          </label>

          <div className={styles.fieldFull}>
            <span className={styles.fieldLabel}>첨부파일 안내</span>
            <div className={styles.attachmentDropzone}>
              <span className={styles.dropzoneIcon}>📎</span>
              <div className={styles.dropzoneText}>
                <strong>파일은 업무 생성 완료 후 상세페이지에서 업로드할 수 있습니다.</strong>
                <p>생성된 고유 업무 ID를 기준으로 첨부파일의 버전 및 무결성이 안전하게 관리됩니다.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 피드백 메시지 */}
      {feedback ? (
        <div
          className={[
            styles.feedbackBanner,
            feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,
          ].join(' ')}
          role="alert"
        >
          <span className={styles.feedbackIcon}>{feedback.tone === 'error' ? '⚠️' : '✅'}</span>
          <span>{feedback.message}</span>
        </div>
      ) : null}

      {/* 하단 액션 버튼 바 */}
      <div className={styles.formActionBar}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onCancel}
          disabled={submitting}
        >
          취소
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={submitting || submitDisabled}
        >
          {submitting ? (
            <>
              <span className={styles.spinner} /> {submittingLabel}
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  )
}
