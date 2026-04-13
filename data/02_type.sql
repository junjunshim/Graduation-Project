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