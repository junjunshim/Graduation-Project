// 업무와 프로젝트 데이터 모델 정의
#pragma once

#include <string>
#include <optional>
#include <chrono>

using Timestamp = std::chrono::system_clock::time_point; // 시간 데이터를 다루기 위한 타입 별칭
using Date = std::chrono::system_clock::time_point; // SQL DATE 대응

// 개별 업무 단위 및 프로젝트 데이터를 관리
struct WorkItem {
    std::string work_item_id;                // VARCHAR(50) PRIMARY KEY
    int32_t owner_node_id;                   // INTEGER REFERENCES organization_nodes(node_id)
    std::optional<std::string> parent_work_item_id; // REFERENCES work_items(work_item_id)
    std::string owner_user_id;               // VARCHAR(50) REFERENCES users(user_id)
    std::string title;                       // VARCHAR(200) NOT NULL
    std::optional<std::string> description;  // TEXT
    std::string status = "todo";             // VARCHAR(20) NOT NULL DEFAULT 'todo'
    int32_t priority = 3;                    // INTEGER DEFAULT 3 (1~5)
    int32_t weight = 1;                      // INTEGER DEFAULT 1 (>= 0)
    int32_t progress = 0;                    // INTEGER DEFAULT 0 (0~100)
    std::optional<Date> start_date;          // DATE
    std::optional<Date> due_date;            // DATE
    Timestamp create_at;                     // DEFAULT CURRENT_TIMESTAMP (업무 생성 일시)
};