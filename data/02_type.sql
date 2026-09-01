-- 1. 통합 데이터 반환 타입 정의
DROP TYPE IF EXISTS integrated_data CASCADE;
CREATE TYPE integrated_data AS (
    out_data JSONB
);
