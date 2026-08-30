import { Link } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { AssignRoleForm } from '../components/AssignRoleForm'
import { CreateSubNodeForm } from '../components/CreateSubNodeForm'
import { InheritedManagersPanel } from '../components/InheritedManagersPanel'
import { NextActionsPanel } from '../components/NextActionsPanel'
import { NodeEditForm } from '../components/NodeEditForm'
import { OrgDetailPanel } from '../components/OrgDetailPanel'
import { OrgTree } from '../components/OrgTree'
import { UpdateRoleForm } from '../components/UpdateRoleForm'
import { useOrgManagement } from '../hooks/useOrgManagement'
import { isServerDataSource } from '../../workspace/data/workspaceMode'
import styles from '../styles/OrgManagePage.module.css'

export function OrgManagePage() {
  const currentUser = getCurrentUser()
  const isServerMode = isServerDataSource()
  const {
    assignRoleName,
    editNodeName,
    editNodeType,
    feedback,
    handleNodeUpdateSubmit,
    handleRoleSubmit,
    handleRoleUpdateSubmit,
    handleSubNodeSubmit,
    managerEmail,
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
  } = useOrgManagement(currentUser)

  if (!currentUser) {
    return null
  }

  if (visibleOrgNodes.length === 0) {
    return (
      <section className={styles.page}>
        <section className={styles.emptyPanel}>
          <p className={styles.eyebrow}>Database</p>
          <h2 className={styles.title}>먼저 공유 공간을 만들어 주세요.</h2>
          <p className={styles.description}>
            조직 관리 화면은 공유 공간이 있어야 시작할 수 있습니다. 최상위 공간을 만든 뒤 다시 돌아오세요.
          </p>
          <Link to="/setup/top-node" className={styles.inlineAction}>
            공유 공간 만들기
          </Link>
        </section>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.pageIntro}>
        <p className={styles.eyebrow}>Database</p>
        <h2 className={styles.title}>조직과 권한을 문서처럼 관리하세요.</h2>
        <p className={styles.description}>
          좌측에서 조직을 고르고, 중앙에서 세부 내용을 확인하고, 우측에서 즉시 편집 작업을 실행할 수 있습니다.
        </p>
      </header>

      {feedback ? (
        <div
          className={[
            styles.feedback,
            feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,
          ].join(' ')}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className={styles.manageGrid}>
        <OrgTree
          nodes={visibleOrgNodes}
          rootNodes={rootNodes}
          selectedNodeId={selectedNodeId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={setSelectedNodeId}
        />

        <section className={styles.documentColumn}>
          <OrgDetailPanel selectedDetail={selectedDetail} />
        </section>

        <aside className={styles.actionColumn}>
          {selectedDetail ? <InheritedManagersPanel managers={selectedDetail.inheritedManagers} /> : null}

          {selectedDetail ? (
            <NodeEditForm
              selectedDetail={selectedDetail}
              editNodeName={editNodeName}
              editNodeType={editNodeType}
              busy={Boolean(pendingAction)}
              onEditNodeNameChange={setEditNodeName}
              onEditNodeTypeChange={setEditNodeType}
              onSubmit={handleNodeUpdateSubmit}
            />
          ) : null}

          <CreateSubNodeForm
            managerEmail={managerEmail}
            subNodeName={subNodeName}
            subNodeType={subNodeType}
            users={snapshot.users.filter(
              (user) => Boolean(user.email) && !user.email.endsWith('@local.invalid'),
            )}
            allowCustomManagerEmail={isServerMode}
            disabled={!selectedDetail?.canManage || Boolean(pendingAction)}
            busy={pendingAction === 'create-sub-node'}
            onManagerEmailChange={setManagerEmail}
            onSubNodeNameChange={setSubNodeName}
            onSubNodeTypeChange={setSubNodeType}
            onSubmit={handleSubNodeSubmit}
          />

          <AssignRoleForm
            assignRoleName={assignRoleName}
            roleEmail={roleEmail}
            users={snapshot.users.filter(
              (user) => Boolean(user.email) && !user.email.endsWith('@local.invalid'),
            )}
            allowCustomEmail={isServerMode}
            disabled={!selectedDetail?.canManage || Boolean(pendingAction)}
            busy={pendingAction === 'assign-role'}
            onAssignRoleNameChange={setAssignRoleName}
            onRoleEmailChange={setRoleEmail}
            onSubmit={handleRoleSubmit}
          />

          {selectedDetail ? (
            <UpdateRoleForm
              selectedDetail={selectedDetail}
              updateRoleEmail={updateRoleEmail}
              updateRoleName={updateRoleName}
              busy={Boolean(pendingAction)}
              onUpdateRoleEmailChange={setUpdateRoleEmail}
              onUpdateRoleNameChange={setUpdateRoleName}
              onSubmit={handleRoleUpdateSubmit}
            />
          ) : null}

          {selectedDetail ? <NextActionsPanel nextActions={selectedDetail.nextActions} /> : null}
        </aside>
      </div>
    </section>
  )
}
