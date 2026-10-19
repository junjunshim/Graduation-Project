-- Authority System Constant Seeds
INSERT INTO authority_constants (name, bit_position, description) VALUES
('NODE_INFO_VIEW', 0, '해당 노드 정보 식별 가능'), -- 모든 역할의 최소 권한
('NODE_MEMBERS_VIEW', 1, '해당 노드의 멤버들 식별 가능'),
('NODE_SUB_VIEW', 2, '해당 노드의 하위 노드들 식별 가능'),
('NODE_PARENT_VIEW', 3, '해당 노드의 부모 노드들 식별 가능'),
('WI_PUBLIC_VIEW', 4, '노드의 공개 work-item 식별 가능'),
('WI_OTHERS_DETAIL_VIEW', 5, '다른 사용자의 work-item 상세 조회 가능'),
('WI_HIDDEN_VIEW', 6, '노드의 숨김 속성 work-item 조회 및 상세조회 가능'),
-- (bit 7 reserved)
-- WI Change Bits (8-11)
('WI_PERSONAL_CHANGE', 8, '개인 work-item 생성 및 변경 가능'),
('WI_HIDDEN_CHANGE', 9, '숨김 속성 work-itme 생성 및 변경 가능'),
('WI_ASSIGN', 10, '다른 사용자에게 work-item 배정 가능'),
('WI_OTHERS_CHANGE', 11, '다른 사용자 work-item 변경 및 삭제 가능'),
-- Node Change Bits (12-15)
('NODE_INFO_CHANGE', 12, '노드 정보 변경 가능'),
('NODE_SUB_CREATE', 13, '하위 노드 생성 가능'),
('NODE_ADD_ROLE', 14,'사용자에게 역할 부여 가능'),
('ROLE_CHANGE', 15, '역할 생성 및 권한 변경 가능'),
-- Integration Bits (16-17)
('FILE_VIEW', 16, '파일 조회 및 다운로드 가능'),
('FILE_CHANGE', 17, '파일 등록 및 삭제 가능'),
-- Schedule Bits (18-19)
('SCHEDULE_VIEW', 18, '정기 일정 조회 가능'),
('SCHEDULE_CHANGE', 19, '정기 일정 생성 및 변경 가능'),
-- History Bits (20-21)
('HISTORY_PERSONAL_VIEW', 20, '개인 히스토리 식별 가능'),
('HISTORY_ALL_VIEW', 21, '노드의 모든 히스토리 식별 가능'),
-- GitHub Integration (22-24)
('GITHUB_VIEW', 22, '연결된 저장소(저장소/브랜치/커밋/파일) 조회 가능'),
('GITHUB_CHANGE', 23, '저장소 편집 — 브랜치 생성/삭제, 커밋, push, 파일 조작 가능'),
('GITHUB_REPO_MANAGE', 24, '원격 저장소 추가(연결)/해제 가능'),
-- Channel Chat Bits (25-27)
('CHANNEL_VIEW', 25, '워크스페이스 채널 목록 및 메시지 조회 가능'),
('CHANNEL_CHAT', 26, '워크스페이스 채널 메시지/스레드 작성 및 파일 첨부 가능'),
('CHANNEL_MANAGE', 27, '워크스페이스 채널 생성/수정/삭제 및 메시지 관리 가능'),
-- (bit 28 ~ 30 reserved)
('DENY', 31, '하위 비트 상관없이 모든 권한 X');

-- Role Default Permissions
-- admin => DENY 비트(31) 제외 모두 1 (예약 비트도 ON — 신규 권한을 추가해도 ADMIN 마스크는 고칠 필요가 없다)
-- manager => bit 0~6, 8~11, 13~23, 25~27 ON (bit 12 NODE_INFO_CHANGE, bit 24 GITHUB_REPO_MANAGE 제외) -> B'00001110111111111110111101111111'
-- member  => bit 0~2, 4~6, 8, 9, 16~23, 25~26 ON                                                 -> B'00000110111111110000001101110111'
-- viewer  => bit 0, 1, 4, 5, 16, 18, 20, 21, 22, 25 ON                                           -> B'00000010011101010000000000110011'

INSERT INTO role_defaults (role, default_authority) VALUES
('ADMIN',   B'01111111111111111111111111111111'),
('MANAGER', B'00001110111111111110111101111111'),
('MEMBER',  B'00000110111111110000001101110111'),
('VIEWER',  B'00000010011101010000000000110011');

UPDATE role_defaults SET is_top_role = TRUE WHERE role = 'ADMIN';
