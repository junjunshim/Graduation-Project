-- 0. 권한 비트마스크 공통 정의 (중앙화 지점)
--
--    ▶ 권한 비트 "폭"을 바꿀 때 수정해야 하는 유일한 SQL 지점이다.
--      - authority_mask      : 비트마스크 컬럼/변수 타입 (BIT(n))
--      - authority_mask_text : API로 주고받는 2진수 문자열 타입 (VARCHAR(n))
--      두 도메인의 n만 바꾸면 03_func_*.sql 의 타입 선언과 마스크 생성 코드는 그대로 동작한다.
--    ▶ 개별 비트 마스크는 (B'0...01'::BIT(n) << bit_position) 리터럴 대신 authority_mask_of() 로 만든다.
--    ▶ 이 파일은 스키마/함수 파일보다 먼저 실행되어야 하므로 파일명을 00_ 으로 둔다.

DROP DOMAIN IF EXISTS authority_mask_text CASCADE;
DROP DOMAIN IF EXISTS authority_mask CASCADE;

CREATE DOMAIN authority_mask AS BIT(24);
CREATE DOMAIN authority_mask_text AS VARCHAR(24);

-- 권한 비트 폭을 도메인 정의에서 파생시킨다(마스크 시프트와 CHECK 제약에 사용).
CREATE OR REPLACE FUNCTION authority_bit_length() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
    SELECT length(B'0'::authority_mask);
$$;

-- bit_position 위치의 비트 하나만 1인 마스크를 만든다.
-- 비트 문자열은 오른쪽이 LSB 이므로, 최하위 비트(LSB)만 1인 마스크를 먼저 만든 뒤 왼쪽으로 민다.
CREATE OR REPLACE FUNCTION authority_mask_of(p_bit_position INTEGER)
RETURNS authority_mask
LANGUAGE sql IMMUTABLE AS $$
    SELECT (B'1'::authority_mask >> (authority_bit_length() - 1)) << p_bit_position;
$$;