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
-- Integration Bits (16-19)
('FILE_VIEW', 16, '파일 조회 및 다운로드 가능'),
('FILE_CHANGE', 17, '파일 등록 및 삭제 가능'),
-- (bit 18, 19 reserved)
-- History Bits (20-23)
('HISTORY_PERSONAL_VIEW', 20, '개인 히스토리 식별 가능'),
('HISTORY_ALL_VIEW', 21, '노드의 모든 히스토리 식별 가능'),
-- (bit 22 reserved)
('DENY', 23, '하위 비트 상관없이 모든 권한 X');

-- Role Default Permissions
-- admin => deny 비트(23) 제외 모두 1
-- manager => bit 0~6, 8~17, 20, 21 ON  -> B'001100111111111101111111'
-- member  => bit 0~4, 6, 8, 9, 16, 17, 20 ON    -> B'000100110000001101010111'
-- viewer  => bit 0, 4 ON (파일 권한 제외)       -> B'000000000000000000010001'

INSERT INTO role_defaults (role, default_authority) VALUES
('ADMIN',   B'011111111111111111111111'),
('MANAGER', B'001100111111111101111111'),
('MEMBER',  B'000100110000001101010111'),
('VIEWER',  B'000000000000000000010001');
