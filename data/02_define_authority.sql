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
-- (bit 10 reserved)
('WI_OTHERS_CHANGE', 11, '다른 사용자 work-item 변경 및 삭제 가능'),
-- Node Change Bits (12-15)
('NODE_INFO_CHANGE', 12, '노드 정보 변경 가능'),
('NODE_SUB_CREATE', 13, '하위 노드 생성 가능'),
('NODE_ADD_ROLE', 14,'사용자에게 역할 부여 가능'),
-- (bit 15 reserved)
-- Integration Bits (16-19)
('INTEGRATION_GENERAL', 16, '파일 공유, github 연동, vscode 관련 기능'),
-- (bit 17, 18, 19 reserved)
-- History Bits (20-23)
('HISTORY_PERSONAL_VIEW', 20, '개인 히스토리 식별 가능'),
('HISTORY_ALL_VIEW', 21, '노드의 모든 히스토리 식별 가능'),
-- (bit 22 reserved)
('DENY', 23, '하위 비트 상관없이 모든 권한 X');

-- Role Default Permissions
-- admin => deny 비트 제외 1
-- manager => 0011 0000 0010 1011 0111 1111 (0x302B7F)
-- member_high => 0001 0000 0000 0011 0101 1111 (0x10035F)
-- member_low => 0001 0000 0000 0001 0001 0111 (0x100117)
-- viewer => 0000 0000 0000 0000 0001 0001 (0x00011)

INSERT INTO role_defaults (role, default_authority) VALUES
('ADMIN',   B'011111111111111111111111'),
('MANAGER', B'001100000110101101111111'),
('MEMBER',  B'000100000000001101011111'), -- Using member_high for MEMBER enum
('VIEWER',  B'000000000000000000010001');
