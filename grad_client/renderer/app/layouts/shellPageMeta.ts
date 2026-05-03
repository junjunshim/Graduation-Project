export type ShellPageMeta = {
  section: string
  title: string
  description: string
  actionLabel: string
  actionTo: string
}

export function getShellPageMeta(pathname: string, hasOrgContext: boolean): ShellPageMeta {
  if (pathname === '/work-items/new') {
    return {
      section: 'Work Item',
      title: '새 업무 등록',
      description: '조직, 담당자, 일정, 진행 속성을 하나의 페이지에서 작성합니다.',
      actionLabel: '조직 관리',
      actionTo: '/org/manage',
    }
  }

  const workItemEditMatch = pathname.match(/^\/work-items\/([^/]+)\/edit$/)

  if (workItemEditMatch) {
    const [, workItemId] = workItemEditMatch

    return {
      section: 'Work Item',
      title: '업무 수정',
      description: '업무 수정 라우트의 구조를 준비하고 현재 업무 컨텍스트를 확인합니다.',
      actionLabel: '상세 보기',
      actionTo: `/work-items/${workItemId}`,
    }
  }

  const workItemDetailMatch = pathname.match(/^\/work-items\/([^/]+)$/)

  if (workItemDetailMatch) {
    const [, workItemId] = workItemDetailMatch

    return {
      section: 'Work Item',
      title: '업무 상세',
      description: '업무 본문과 상위·하위 관계, 담당 정보를 한 화면에서 읽습니다.',
      actionLabel: '업무 수정',
      actionTo: `/work-items/${workItemId}/edit`,
    }
  }

  if (pathname === '/dashboard') {
    return hasOrgContext
      ? {
          section: 'Workspace',
          title: '내 업무',
          description: '내가 맡은 업무와 마감 임박 항목만 빠르게 확인합니다.',
          actionLabel: '업무 등록',
          actionTo: '/work-items/new',
        }
      : {
          section: 'Onboarding',
          title: '공유 공간을 만들어 보세요',
          description: '팀이 함께 사용할 첫 공간을 만들고 워크스페이스를 시작합니다.',
          actionLabel: '공간 만들기',
          actionTo: '/setup/top-node',
        }
  }

  if (pathname === '/setup/top-node') {
    return {
      section: 'Workspace Setup',
      title: '공유 공간 만들기',
      description: '최상위 조직을 등록하고 워크스페이스의 기준을 세웁니다.',
      actionLabel: '대시보드',
      actionTo: '/dashboard',
    }
  }

  if (pathname === '/org/manage') {
    return {
      section: 'Database',
      title: '조직과 권한',
      description: '조직 트리, 역할, 연결된 업무를 문서처럼 관리합니다.',
      actionLabel: '업무 등록',
      actionTo: '/work-items/new',
    }
  }

  return {
    section: 'Workspace',
    title: '운영 현황',
    description: '워크스페이스 화면으로 이동해 현재 업무를 확인합니다.',
    actionLabel: '대시보드',
    actionTo: '/dashboard',
  }
}
