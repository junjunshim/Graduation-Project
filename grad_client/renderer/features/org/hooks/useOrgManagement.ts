import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { assignRoleToNode, createSubNode, getOrgSnapshot } from '../../workspace/data/orgService'
import { getSelectedNodeDetail } from '../../workspace/queries/selectedNodeDetail'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import type { NodeType, RoleName, UserRecord } from '../../workspace/model/types'

export function useOrgManagement(currentUser: UserRecord | null) {
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [subNodeType, setSubNodeType] = useState<Exclude<NodeType, 'USER'>>('TEAM')
  const [subNodeName, setSubNodeName] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [roleEmail, setRoleEmail] = useState('')
  const [assignRoleName, setAssignRoleName] = useState<RoleName>('MEMBER')
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const [overview, setOverview] = useState(() => (currentUser ? getWorkspaceOverview(currentUser.userId) : null))

  const visibleOrgNodes = useMemo(
    () => overview?.visibleNodes.filter((node) => node.nodeType !== 'USER') ?? [],
    [overview],
  )

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
  }, [currentUser, managerEmail, roleEmail])

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

  const selectedDetail =
    currentUser && selectedNodeId ? getSelectedNodeDetail(selectedNodeId, currentUser.userId) : null

  function refreshWorkspace() {
    if (!currentUser) {
      return
    }

    setSnapshot(getOrgSnapshot())
    setOverview(getWorkspaceOverview(currentUser.userId))
  }

  async function handleSubNodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedNodeId) {
      setFeedback({ tone: 'error', message: '먼저 기준이 될 조직을 선택해 주세요.' })
      return
    }

    const response = await createSubNode({
      nodeType: subNodeType,
      parentNodeId: selectedNodeId,
      name: subNodeName,
      email: managerEmail,
      roleName: 'ADMIN',
    })

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: '하위 조직을 추가하지 못했습니다. 입력 정보를 확인해 주세요.' })
      return
    }

    setFeedback({ tone: 'success', message: '하위 조직이 추가되었습니다.' })
    setSubNodeName('')
    refreshWorkspace()
  }

  async function handleRoleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedNodeId) {
      setFeedback({ tone: 'error', message: '권한을 추가할 조직을 먼저 선택해 주세요.' })
      return
    }

    const response = await assignRoleToNode({
      email: roleEmail,
      nodeId: selectedNodeId,
      roleName: assignRoleName,
    })

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: '권한을 추가하지 못했습니다. 입력 정보를 확인해 주세요.' })
      return
    }

    setFeedback({ tone: 'success', message: '권한이 추가되었습니다.' })
    refreshWorkspace()
  }

  return {
    assignRoleName,
    feedback,
    handleRoleSubmit,
    handleSubNodeSubmit,
    managerEmail,
    overview,
    roleEmail,
    rootNodes,
    selectedDetail,
    selectedNodeId,
    setAssignRoleName,
    setManagerEmail,
    setRoleEmail,
    setSelectedNodeId,
    setSubNodeName,
    setSubNodeType,
    snapshot,
    subNodeName,
    subNodeType,
    visibleOrgNodes,
  }
}
