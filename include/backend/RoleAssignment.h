// 유저와 노드 간의 권한 매핑
#pragma once

#include <string>
#include <chrono>

// 시간 데이터를 다루기 위한 타입 별칭
using Timestamp = std::chrono::system_clock::time_point;

// 특정 사용자가 특정 조직 노드에 대해 가지는 역할 정의
struct RoleAssignment {
    int32_t assignment_id;                   // SERIAL PRIMARY KEY
    std::string user_id;                     // VARCHAR(50) REFERENCES users(user_id)
    int32_t node_id;                         // INTEGER REFERENCES organization_nodes(node_id)
    std::string role;                        // VARCHAR(20) NOT NULL
    Timestamp create_at;                     // DEFAULT CURRENT_TIMESTAMP (권한 할당 일시)
};