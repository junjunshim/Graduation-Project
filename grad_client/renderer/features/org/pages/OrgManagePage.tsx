import { Link } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { AssignRoleForm } from '../components/AssignRoleForm'
import { CreateSubNodeForm } from '../components/CreateSubNodeForm'
import { OrgDetailPanel } from '../components/OrgDetailPanel'
import { OrgTree } from '../components/OrgTree'
import { useOrgManagement } from '../hooks/useOrgManagement'
import styles from './OrgManagePage.module.css'

export function OrgManagePage() {
  const currentUser = getCurrentUser()
  const {
    assignRoleName,
    feedback,
    handleRoleSubmit,
    handleSubNodeSubmit,
    managerEmail,
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
        >
          {feedback.message}
        </div>
      ) : null}

      <div className={styles.manageGrid}>
        <OrgTree
          nodes={visibleOrgNodes}
          rootNodes={rootNodes}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
        />

        <section className={styles.documentColumn}>
          <OrgDetailPanel selectedDetail={selectedDetail} />
        </section>

        <aside className={styles.actionColumn}>
          {selectedDetail ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelEyebrow}>Managers</p>
                  <h3 className={styles.panelTitle}>관리 가능한 사용자</h3>
                </div>
              </div>

              <div className={styles.databaseList}>
                {selectedDetail.inheritedManagers.length > 0 ? (
                  selectedDetail.inheritedManagers.map((manager) => (
                    <article key={manager.userId} className={styles.databaseRow}>
                      <div className={styles.rowCopy}>
                        <strong>{manager.name}</strong>
                        <p className={styles.rowMeta}>
                          {manager.userId} · {manager.email}
                        </p>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className={styles.emptyState}>상속된 관리자 정보가 없습니다.</p>
                )}
              </div>
            </section>
          ) : null}

          <CreateSubNodeForm
            managerEmail={managerEmail}
            subNodeName={subNodeName}
            subNodeType={subNodeType}
            users={snapshot.users}
            onManagerEmailChange={setManagerEmail}
            onSubNodeNameChange={setSubNodeName}
            onSubNodeTypeChange={setSubNodeType}
            onSubmit={handleSubNodeSubmit}
          />

          <AssignRoleForm
            assignRoleName={assignRoleName}
            roleEmail={roleEmail}
            users={snapshot.users}
            onAssignRoleNameChange={setAssignRoleName}
            onRoleEmailChange={setRoleEmail}
            onSubmit={handleRoleSubmit}
          />

          {selectedDetail ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelEyebrow}>Next Actions</p>
                  <h3 className={styles.panelTitle}>다음 작업</h3>
                </div>
              </div>

              <div className={styles.nextActionList}>
                {selectedDetail.nextActions.map((action) => (
                  <Link key={action.label} to={action.href} className={styles.nextActionItem}>
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
