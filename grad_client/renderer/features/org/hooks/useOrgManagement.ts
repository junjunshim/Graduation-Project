import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { assignRoleToNode, createSubNode, getOrgSnapshot, updateNode, updateRole } from '../../workspace/data/orgService'
import { getSelectedNodeDetail } from '../../workspace/queries/selectedNodeDetail'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import type { NodeType, RoleName, UserRecord } from '../../workspace/model/types'
import { isServerDataSource } from '../../workspace/data/workspaceMode'

export function useOrgManagement(currentUser: UserRecord | null) {
  const requireDirectManagementRole = isServerDataSource()
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [subNodeType, setSubNodeType] = useState<Exclude<NodeType, 'USER'>>('TEAM')
  const [subNodeName, setSubNodeName] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [roleEmail, setRoleEmail] = useState('')
  const [assignRoleName, setAssignRoleName] = useState<RoleName>('MEMBER')
  const [searchQuery, setSearchQuery] = useState('')
  const [editNodeName, setEditNodeName] = useState('')
  const [editNodeType, setEditNodeType] = useState<Exclude<NodeType, 'USER'>>('TEAM')
  const [updateRoleEmail, setUpdateRoleEmail] = useState('')
  const [updateRoleName, setUpdateRoleName] = useState<RoleName>('MEMBER')
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const pendingActionRef = useRef<string | null>(null)

  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const [overview, setOverview] = useState(() =>
    currentUser ? getWorkspaceOverview(currentUser.userId, snapshot) : null,
  )

  const visibleOrgNodes = useMemo(() => {
    const orgNodes = overview?.visibleNodes.filter((node) => node.nodeType !== 'USER') ?? []
    const query = searchQuery.trim().toLowerCase()

    if (!query) {
      return orgNodes
    }

    const matchedIds = new Set<number>()
    const orgNodeIds = new Set(orgNodes.map((node) => node.id))

    orgNodes.forEach((node) => {
      if (!node.name.toLowerCase().includes(query) && !node.nodeType.toLowerCase().includes(query)) {
        return
      }

      node.path.forEach((pathNodeId) => {
        if (orgNodeIds.has(pathNodeId)) {
          matchedIds.add(pathNodeId)
        }
      })
    })

    return orgNodes.filter((node) => matchedIds.has(node.id))
  }, [overview, searchQuery])

  useEffect(() => {
    if (!currentUser) {
      return
    }

    if (!managerEmail) {
      setManagerEmail(currentUser.email)
    }

    if (!roleEmail) {
      setRoleEmail(currentUser.email)
    }

    if (!updateRoleEmail) {
      setUpdateRoleEmail(currentUser.email)
    }
  }, [currentUser, managerEmail, roleEmail, updateRoleEmail])

  useEffect(() => {
    if (visibleOrgNodes.length === 0) {
      setSelectedNodeId(null)
      return
    }

    if (!selectedNodeId || !visibleOrgNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(visibleOrgNodes[0].id)
    }
  }, [selectedNodeId, visibleOrgNodes])

  const rootNodes = visibleOrgNodes.filter((node) => {
    if (!node.parentNodeId) {
      return true
    }

    return !visibleOrgNodes.some((candidate) => candidate.id === node.parentNodeId)
  })

  const currentUserId = currentUser?.userId
  const selectedDetail = useMemo(
    () =>
      currentUserId && selectedNodeId
        ? getSelectedNodeDetail(
            selectedNodeId,
            currentUserId,
            snapshot,
            { requireDirectManagementRole },
          )
        : null,
    [currentUserId, requireDirectManagementRole, selectedNodeId, snapshot],
  )
  const selectedDetailNodeId = selectedDetail?.node.id
  const selectedDetailNodeName = selectedDetail?.node.name ?? ''
  const selectedDetailNodeType = selectedDetail?.node.nodeType
  const selectedDetailFirstRoleEmail = selectedDetail?.directRoles[0]?.email ?? ''
  const selectedDetailFirstRoleName = selectedDetail?.directRoles[0]?.roleName ?? 'MEMBER'

  useEffect(() => {
    if (!selectedDetailNodeId) {
      return
    }

    setEditNodeName(selectedDetailNodeName)

    if (selectedDetailNodeType && selectedDetailNodeType !== 'USER') {
      setEditNodeType(selectedDetailNodeType)
    }

    if (selectedDetailFirstRoleEmail) {
      setUpdateRoleEmail(selectedDetailFirstRoleEmail)
      setUpdateRoleName(selectedDetailFirstRoleName)
    }
  }, [
    selectedDetailFirstRoleEmail,
    selectedDetailFirstRoleName,
    selectedDetailNodeId,
    selectedDetailNodeName,
    selectedDetailNodeType,
  ])

  function refreshWorkspace() {
    if (!currentUser) {
      return
    }

    const nextSnapshot = getOrgSnapshot()
    setSnapshot(nextSnapshot)
    setOverview(getWorkspaceOverview(currentUser.userId, nextSnapshot))
  }

  async function runMutation<Result>(action: string, operation: () => Promise<Result>) {
    if (pendingActionRef.current) {
      return null
    }

    pendingActionRef.current = action
    setPendingAction(action)

    try {
      return await operation()
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '요청을 처리하지 못했습니다.',
      })
      return null
    } finally {
      pendingActionRef.current = null
      setPendingAction(null)
    }
  }

  async function handleSubNodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedDetail?.canManage) {
      setFeedback({ tone: 'error', message: '선택한 조직을 관리할 권한이 없습니다.' })
      return
    }

    if (!selectedNodeId) {
      setFeedback({ tone: 'error', message: '먼저 기준이 될 조직을 선택해 주세요.' })
      return
    }

    if (!subNodeName.trim()) {
      setFeedback({ tone: 'error', message: '하위 조직 이름을 입력해 주세요.' })
      return
    }

    if (!managerEmail.trim()) {
      setFeedback({ tone: 'error', message: '관리자 이메일을 입력해 주세요.' })
      return
    }

    const response = await runMutation('create-sub-node', () =>
      createSubNode({
        nodeType: subNodeType,
        parentNodeId: selectedNodeId,
        name: subNodeName,
        email: managerEmail,
        roleName: 'ADMIN',
      }),
    )

    if (!response) {
      return
    }

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: response.message })
      return
    }

    setFeedback({ tone: 'success', message: '하위 조직이 추가되었습니다.' })
    setSubNodeName('')
    refreshWorkspace()
  }

  async function handleRoleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedDetail?.canManage) {
      setFeedback({ tone: 'error', message: '선택한 조직을 관리할 권한이 없습니다.' })
      return
    }

    if (!selectedNodeId) {
      setFeedback({ tone: 'error', message: '권한을 추가할 조직을 먼저 선택해 주세요.' })
      return
    }

    if (!roleEmail.trim()) {
      setFeedback({ tone: 'error', message: '권한을 부여할 사용자 이메일을 입력해 주세요.' })
      return
    }

    const response = await runMutation('assign-role', () =>
      assignRoleToNode({
        email: roleEmail,
        nodeId: selectedNodeId,
        roleName: assignRoleName,
      }),
    )

    if (!response) {
      return
    }

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: response.message })
      return
    }

    setFeedback({ tone: 'success', message: '권한이 추가되었습니다.' })
    refreshWorkspace()
  }

  async function handleNodeUpdateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedDetail?.canManage) {
      setFeedback({ tone: 'error', message: '선택한 조직을 수정할 권한이 없습니다.' })
      return
    }

    if (!editNodeName.trim()) {
      setFeedback({ tone: 'error', message: '조직 이름을 입력해 주세요.' })
      return
    }

    const response = await runMutation('update-node', () =>
      updateNode({
        nodeId: selectedDetail.node.id,
        name: editNodeName,
        nodeType: editNodeType,
      }),
    )

    if (!response) {
      return
    }

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: response.message })
      return
    }

    setFeedback({ tone: 'success', message: '조직 정보를 수정했습니다.' })
    refreshWorkspace()
  }

  async function handleRoleUpdateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedDetail?.canManage) {
      setFeedback({ tone: 'error', message: '선택한 조직의 권한을 변경할 권한이 없습니다.' })
      return
    }

    const response = await runMutation('update-role', () =>
      updateRole({
        email: updateRoleEmail,
        nodeId: selectedDetail.node.id,
        roleName: updateRoleName,
      }),
    )

    if (!response) {
      return
    }

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: response.message })
      return
    }

    setFeedback({ tone: 'success', message: '권한을 변경했습니다.' })
    refreshWorkspace()
  }

  return {
    assignRoleName,
    editNodeName,
    editNodeType,
    feedback,
    handleNodeUpdateSubmit,
    handleRoleSubmit,
    handleRoleUpdateSubmit,
    handleSubNodeSubmit,
    managerEmail,
    overview,
    pendingAction,
    roleEmail,
    rootNodes,
    searchQuery,
    selectedDetail,
    selectedNodeId,
    setAssignRoleName,
    setEditNodeName,
    setEditNodeType,
    setManagerEmail,
    setRoleEmail,
    setSearchQuery,
    setSelectedNodeId,
    setSubNodeName,
    setSubNodeType,
    setUpdateRoleEmail,
    setUpdateRoleName,
    snapshot,
    subNodeName,
    subNodeType,
    updateRoleEmail,
    updateRoleName,
    visibleOrgNodes,
  }
}
