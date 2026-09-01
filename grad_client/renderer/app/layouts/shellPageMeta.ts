export type ShellPageMeta = {
  section: string
  title: string
  description: string
  actionLabel: string
  actionTo: string
}

export function getShellPageMeta(pathname: string, hasOrgContext: boolean, search = ''): ShellPageMeta {
  if (pathname === '/work-items') {
    const activeView = new URLSearchParams(search).get('view') === 'create' ? 'create' : 'list'

    if (activeView === 'create') {
      return {
        section: 'Work Items',
        title: '업무 생성',
        description: '새로운 업무를 등록하세요.',
        actionLabel: '업무 목록',
        actionTo: '/work-items',
      }
    }

    return {
      section: 'Work Items',
      title: '업무 목록',
      description: '전체 업무를 확인하고 관리할 수 있습니다.',
      actionLabel: '업무 등록',
      actionTo: '/work-items/new',
    }
  }

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
      description: '업무의 상세 정보와 진행 상태를 수정하세요.',
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

  if (pathname === '/workspace') {
    return {
      section: 'Workspace',
      title: '워크 스페이스',
      description: '업무, 일정, 문서, 활동을 한 화면에서 정돈해 확인합니다.',
      actionLabel: '새 업무',
      actionTo: '/work-items/new',
    }
  }

  if (pathname === '/org/manage') {
    return {
      section: 'Workspace Admin',
      title: '조직 관리',
      description: '조직 트리, 역할, 연결된 업무를 문서처럼 관리합니다.',
      actionLabel: '워크 스페이스',
      actionTo: '/workspace',
    }
  }

  if (pathname === '/calendar') {
    return {
      section: 'Calendar',
      title: '캘린더',
      description: '마감 일정과 업무 일정을 한 화면에서 볼 수 있도록 준비 중입니다.',
      actionLabel: '업무 등록',
      actionTo: '/work-items/new',
    }
  }

  if (pathname === '/documents') {
    return {
      section: 'Documents',
      title: '문서',
      description: '회의록과 업무 문서를 연결하는 공간을 준비 중입니다.',
      actionLabel: '업무 등록',
      actionTo: '/work-items/new',
    }
  }

  if (pathname === '/files') {
    return {
      section: 'Files',
      title: '파일',
      description: '업무별 첨부 파일과 자료를 정리하는 화면을 준비 중입니다.',
      actionLabel: '업무 등록',
      actionTo: '/work-items/new',
    }
  }

  if (pathname === '/settings') {
    return {
      section: 'Settings',
      title: '설정',
      description: '워크스페이스 환경과 계정 옵션을 관리하는 화면을 준비 중입니다.',
      actionLabel: '대시보드',
      actionTo: '/dashboard',
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
