#pragma once

#include <string>
#include <vector>
#include <optional>
#include <chrono>

using Timestamp = std::chrono::system_clock::time_point;

struct OrganizationNode {
    int32_t node_id;                         // SERIAL PRIMARY KEY
    std::string node_type;                   // VARCHAR(20) NOT NULL
    std::optional<int32_t> parent_node_id;   // REFERENCES organization_nodes(node_id)
    std::string name;                        // VARCHAR(100) NOT NULL
    std::vector<std::string> path;           // TEXT[] NOT NULL
    Timestamp create_at;                     // DEFAULT CURRENT_TIMESTAMP
};