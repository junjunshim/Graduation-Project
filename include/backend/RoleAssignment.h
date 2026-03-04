#pragma once

#include <string>
#include <chrono>

using Timestamp = std::chrono::system_clock::time_point;

struct RoleAssignment {
    int32_t assignment_id;                   // SERIAL PRIMARY KEY
    std::string user_id;                     // VARCHAR(50) REFERENCES users(user_id)
    int32_t node_id;                         // INTEGER REFERENCES organization_nodes(node_id)
    std::string role;                        // VARCHAR(20) NOT NULL
    Timestamp create_at;                     // DEFAULT CURRENT_TIMESTAMP
};