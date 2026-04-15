-- 1. 통합 데이터 반환 타입 정의
CREATE TYPE integrated_data AS (
    out_type TEXT,
    out_id TEXT,
    out_node_type TEXT,
    out_parent_id TEXT,
    out_title TEXT,
    out_status TEXT,
    out_priority INTEGER,
    out_extra_info TEXT,
    out_updated_at TEXT
);

-- 2. API 통합 반환 타입 정의
CREATE TYPE action_result AS (
    out_res_status BOOLEAN,
    out_message TEXT,
    out_type TEXT,
    out_id TEXT,
    out_node_type TEXT,
    out_parent_id TEXT,
    out_title TEXT,
    out_status TEXT,
    out_priority INTEGER,
    out_extra_info TEXT,
    out_updated_at TEXT
);