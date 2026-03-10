# Electron + React(TypeScript) / FrontEnd Directory Structure Guide

## 1) Directory Structure

```
grad_client/                                  
  electron/                           # Electron 전용
    main/                             # 메인 프로세스 코드(창/OS 기능)
    preload/                          # 프리로드(안전한 통로만 renderer에 노출)
    ipc/                              # IPC 채널/메시지 규칙(허용 목록 포함)

  renderer/                           # 화면 프로세스(React UI가 도는 곳)
    app/                              
      App.tsx                         # 루트 컴포넌트
      routes.tsx                      # 라우팅
      providers.tsx                   # 전역 Provider 모음(캐시/상태/테마 등)

    features/                         # 기능 서랍장(업무 단위로 분리)
      todo/                           # Todo 기능
        components/                   # Todo 전용 UI 부품
        hooks/                        # Todo 전용 훅(반복 로직 묶음)
        pages/                        # Todo 화면
          TodoListPage.tsx            # 목록 화면
          TodoDetailPage.tsx          # 상세 화면
        api.ts                        # Todo 관련 서버 요청 함수 모음
        store.ts                      # Todo 관련 상태
        types.ts                      # Todo 관련 타입(데이터 모양/옵션 등)

      settings/                       # 설정 기능
        pages/                        # Settings 화면
          SettingsPage.tsx            # 설정 화면

    design-system/                    # UI 통일 규칙(글래스모피즘 핵심)
      tokens/                         # 색/투명도/블러/테두리 값 규칙(이름 붙인 숫자표)
      glass/                          # 유리 느낌 공용 컴포넌트
      primitives/                     # 기본 UI(버튼/입력 등)
      global/                         # 전역 스타일(폰트/리셋/기본 배경)

    assets/                           # 아이콘/이미지/폰트 같은 정적 파일
```

---

## 2) 폴더별 상세 설명

아래는 “여기에는 이런 것을 넣는다 / 이런 것은 넣지 않는다”를 적었습니다.  

---

### 3.1 `src/frontend/`
**하는 일**
- 전체 코드의 뿌리입니다. 모든 폴더가 여기 아래에 있습니다.

**하지 않는 일**
- 빌드 결과물(dist) 같은 자동 생성 파일을 넣지 않습니다.

---

### 3.2 `frontend/electron/`
**하는 일**
- Electron 전용 코드만 둡니다.  
- “창 만들기, OS 기능, 앱 종료/재시작” 같은 일을 담당합니다.

**하지 않는 일**
- React 컴포넌트(.tsx) 같은 UI 코드를 두지 않습니다.

#### 3.2.1 `electron/main/`
**하는 일**
- 앱 창 생성/관리  
- OS 기능 처리(파일, 알림 등)  
- 보안 설정(권장: 안전한 기본값 유지)

**하지 않는 일**
- 화면(UI) 로직을 넣지 않습니다. (React 금지)

#### 3.2.2 `electron/preload/`
**하는 일**
- renderer에 필요한 기능만 “작게” 노출합니다.  
- “열어줄 기능 목록”을 최소로 유지합니다.

**하지 않는 일**
- 모든 Node 기능을 통째로 열어주지 않습니다.  

#### 3.2.3 `electron/ipc/`
**하는 일**
- IPC 채널 이름, 메시지 형태(데이터 모양), 허용 목록(화이트리스트)을 관리합니다.  
- “renderer가 어떤 요청을 할 수 있는지”를 한 곳에서 통제합니다.

**하지 않는 일**
- 무분별한 채널 추가를 하지 않습니다.  
- 민감정보(토큰/개인정보)를 IPC로 막 보내지 않습니다.

> 권장 규칙  
- IPC는 **“OS 기능 요청”** 위주로만 사용합니다.  
- 서버 API 호출은 보통 renderer에서 처리해도 됩니다. (단, 인증/보안 설계에 따라 달라질 수 있음)

---

### 3.3 `frontend/renderer/`
**하는 일**
- 사용자가 보는 화면과 UI 로직을 둡니다.  
- React 컴포넌트, 화면 라우팅, UI 상태, 서버 데이터 표시가 여기 있습니다.

**하지 않는 일**
- OS 권한 직접 접근 코드를 넣지 않습니다.  
  (필요하면 preload를 통해 안전하게 접근합니다.)

---

### 3.4 `renderer/app/`
**한 줄 요약**
- 앱의 **입구** 입니다. “전역 연결”을 여기서 합니다.

#### `App.tsx`
**하는 일**
- 앱의 가장 바깥 레이아웃(예: 공통 배경/레이아웃)을 둡니다.

**하지 않는 일**
- Todo 같은 특정 기능의 세부 로직을 넣지 않습니다.  
  (기능 로직은 `features/`로 내려보내는 것이 권장)

#### `routes.tsx`
**하는 일**
- 어떤 경로에서 어떤 페이지를 보여줄지 정리합니다.

**하지 않는 일**
- 페이지 내부 구현(버튼 동작 같은 것)을 여기에 넣지 않습니다.

#### `providers.tsx`
**하는 일**
- 전역 Provider를 한 곳에 모읍니다.  
  예) 서버 캐시 Provider, 전역 상태 Provider, 테마 Provider

**하지 않는 일**
- 기능별 Provider를 섞어서 무한히 키우지 않습니다.  
  (필요하면 feature 단위로 내려서 관리)

---

### 3.5 `renderer/features/`

**하는 일**
- 기능 단위로 코드와 책임을 분리합니다.  

**하지 않는 일**
- 기능과 무관한 공통 UI는 여기로 넣지 않습니다.  
  (공통 UI는 `design-system/`에 둡니다.)

---

## 4) `features/todo/`

### 4.1 `features/todo/pages/`

**하는 일**
- 화면 전체 배치를 담당합니다.
- 화면에서 필요한 feature 컴포넌트/훅/API 호출을 “조립”합니다.

**하지 않는 일**
- 작은 UI 부품을 이 파일 안에 무한히 만들지 않습니다.  
  (작은 부품은 `components/`로 빼는 것이 권장)

---

### 4.2 `features/todo/components/`

**하는 일**
- TodoListPage와 TodoDetailPage에서 함께 쓸 수 있는 컴포넌트를 둡니다.

**하지 않는 일**
- 다른 기능(Settings 등)에서도 쓰는 컴포넌트는 여기 넣지 않습니다.  
  그런 공용 부품은 `design-system/`으로 올리는 것이 권장입니다.

---

### 4.3 `features/todo/hooks/`

**하는 일**
- 필터/검색 입력 제어, 선택 상태 관리, 단축키 처리 같은 반복 로직을 담습니다.

**하지 않는 일**
- OS 기능 호출(IPC) 같은 것은 여기서 직접 하지 않는 편이 안전합니다.

---

### 4.4 `features/todo/api.ts`

**하는 일**
- “목록 조회/상세 조회/추가/수정/삭제” 같은 요청 함수를 둡니다.

**하지 않는 일**
- 화면(UI) 코드를 넣지 않습니다.
- 요청마다 URL/헤더/에러 처리를 제각각 만들지 않습니다.

---

### 4.5 `features/todo/types.ts`

**하는 일**
- Todo 엔티티, 필터/정렬 옵션 타입 등을 정의합니다.

**하지 않는 일**
- “Settings에서도 쓰는 타입”을 여기 넣지 않습니다.  

---

### 4.6 `features/todo/store.ts`

#### 권장(기본값)
- **UI 상태 중심**으로 둡니다.  
  예) 선택된 Todo ID, 모달 열림/닫힘, 현재 필터 값

#### 피하는 편이 안전한 것
- 서버에서 오는 목록/상세 데이터를 store에 “그대로” 넣는 것  
  - 이유: 서버 데이터는 “캐시/재시도/동기화” 규칙이 필요합니다.  
  - 이런 규칙은 보통 서버 캐싱 도구가 더 잘합니다.

---

## 5) `features/settings/` 설명

### 5.1 `features/settings/pages/SettingsPage.tsx`
**하는 일**
- 설정 화면을 구성합니다.

**하지 않는 일**
- 설정 화면에서 Todo 로직을 직접 다루지 않습니다.

---

## 6) `renderer/design-system/`

- “앱 전체 UI가 같은 톤으로 보이게 하는 규칙 폴더”입니다.

### 6.1 `design-system/tokens/`
**하는 일**
- 색/투명도/블러/테두리/그림자 같은 값을 “이름”으로 고정합니다.  

**하지 않는 일**
- 페이지에서 유리 블러 값을 직접 숫자로 막 쓰는 것을 방치하지 않습니다.

---

### 6.2 `design-system/glass/`
**하는 일**
- 글래스모피즘 핵심 부품을 둡니다.

**하지 않는 일**
- 기능 의미가 강한 컴포넌트를 여기 두지 않습니다.  

---

### 6.3 `design-system/primitives/`
**하는 일**
- 버튼/입력창 같은 가장 기본 UI를 둡니다.  
- 디자인 규칙(토큰)을 사용해서 “기본 부품”의 스타일이 흔들리지 않게 합니다.

**하지 않는 일**
- 특정 기능에만 쓰는 버튼 변형을 여기 넣지 않습니다.  

---

### 6.4 `design-system/global/`
**하는 일**
- 전역 스타일을 둡니다.  
  예) 폰트, 기본 배경, CSS reset

**하지 않는 일**
- 기능별 스타일을 여기 넣지 않습니다.

---

## 7) `renderer/assets/` 설명

**하는 일**
- 아이콘/이미지/폰트 파일을 둡니다.

**하지 않는 일**
- 코드(.ts/.tsx) 파일을 여기 넣지 않습니다.

---

## 8) “어디에 둘지” 빠른 결정 규칙

1) **OS 기능(파일/알림/창 등)을 만지는가?**  
   - 예 → `electron/` (main/preload/ipc 중 선택)  
2) **특정 기능(Todo/Settings)에만 속하는가?**  
   - 예 → `renderer/features/해당기능/`  
3) **앱 전체가 같이 쓰는 UI 규칙/부품인가?**  
   - 예 → `renderer/design-system/`  
4) **정적 파일(이미지/폰트)인가?**  
   - 예 → `renderer/assets/`

## 9) 마치며  

- 이 문서는 “FrontEnd Directory Structure Guide” 초안 버전입니다.
- 이해를 위한 예시로 우선 들어간 디렉터리 부분들이 포함되어 있습니다.
- 개발이 진행되면서 디렉터리 구조가 변경이 될 수도 있으며 가이드 내용도 수정이 될 수 있습니다.
- 2026-03-02 1차 작성됨
