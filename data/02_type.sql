CREATE TYPE integrated_data AS (
    out_type TEXT,           -- 'NODE' or 'WORK_ITEM'
    out_id TEXT,
    out_node_type TEXT,      -- 'PROJECT', 'DEPT', etc.
    out_parent_id TEXT,
    out_title TEXT,
    out_status TEXT,
    out_priority INTEGER,
    out_extra_info TEXT,
    out_updated_at TEXT
);