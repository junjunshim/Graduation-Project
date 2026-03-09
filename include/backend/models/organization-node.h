// 모든 공간과 주체의 트리 구조
#pragma once

#include <string>
#include <vector>
#include <optional>
#include <chrono>

// 시간 데이터를 다루기 위한 타입 별칭
using Timestamp = std::chrono::system_clock::time_point;

// 모든 공간과 주체의 트리 구조를 관리
struct OrganizationNode {
    int32_t node_id;                         // SERIAL PRIMARY KEY
    std::string node_type;                   // VARCHAR(20) NOT NULL
    std::optional<int32_t> parent_node_id;   // REFERENCES organization_nodes(node_id)
    std::string name;                        // VARCHAR(100) NOT NULL
    std::vector<int32_t> path;           // TEXT[] NOT NULL
    Timestamp create_at;                     // DEFAULT CURRENT_TIMESTAMP (노드 생성 일시)
};