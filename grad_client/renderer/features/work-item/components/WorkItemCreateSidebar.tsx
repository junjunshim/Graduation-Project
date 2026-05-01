import type { WorkItemComposerContext } from '../../workspace/model/types'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemCreateSidebarProps = {
  composer: WorkItemComposerContext
}

export function WorkItemCreateSidebar({ composer }: WorkItemCreateSidebarProps) {
  return (
    <>
      <section className={styles.sidePanel}>
        <p className={styles.panelEyebrow}>Page Info</p>
        <h3 className={styles.panelTitle}>현재 작성 문서</h3>
        <div className={styles.metaList}>
          <div className={styles.metaRow}>
            <span>ID</span>
            <strong>{composer.suggestedWorkItemId}</strong>
          </div>
          <div className={styles.metaRow}>
            <span>기준 조직</span>
            <strong>{composer.selectedNode?.name ?? '없음'}</strong>
          </div>
          <div className={styles.metaRow}>
            <span>경로</span>
            <strong>{composer.pathLabel}</strong>
          </div>
        </div>
      </section>

      <section className={styles.sidePanel}>
        <p className={styles.panelEyebrow}>Available</p>
        <h3 className={styles.panelTitle}>선택 가능한 범위</h3>
        <div className={styles.metaList}>
          <div className={styles.metaRow}>
            <span>조직</span>
            <strong>{composer.availableNodes.length}개</strong>
          </div>
          <div className={styles.metaRow}>
            <span>담당자</span>
            <strong>{composer.assignableUsers.length}명</strong>
          </div>
          <div className={styles.metaRow}>
            <span>상위 업무</span>
            <strong>{composer.availableParentItems.length}개</strong>
          </div>
        </div>
      </section>

      <section className={styles.sidePanel}>
        <p className={styles.panelEyebrow}>Guide</p>
        <h3 className={styles.panelTitle}>작성 팁</h3>
        <ul className={styles.guideList}>
          <li>제목은 산출물이나 목표가 바로 보이게 작성합니다.</li>
          <li>설명에는 범위, 참고 자료, 완료 기준을 남깁니다.</li>
          <li>진행률은 현재 상태를 반영하도록 주기적으로 갱신합니다.</li>
        </ul>
      </section>
    </>
  )
}
