// 서비스 이용자 정보
#pragma once

#include <string>
#include <optional>
#include <chrono>

// 시간 데이터를 다루기 위한 타입 별칭
using Timestamp = std::chrono::system_clock::time_point;

// 시스템 사용자 정보를 저장
struct User {
    std::string user_id;                   // VARCHAR(50) PRIMARY KEY
    std::string email;                     // VARCHAR(100) UNIQUE NOT NULL
    std::string name;                      // VARCHAR(100) NOT NULL
    std::string password_hash;             // TEXT NOT NULL
    std::optional<int32_t> personal_node_id; // REFERENCES organization_nodes(node_id)
    Timestamp create_at;                   // DEFAULT CURRENT_TIMESTAMP (DB 입력 시 CURRENT_TIMESTAMP에 의헤 자동 기록)
};