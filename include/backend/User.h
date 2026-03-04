#pragma once

#include <string>
#include <optional>
#include <chrono>

using Timestamp = std::chrono::system_clock::time_point;

struct User {
    std::string user_id;                   // VARCHAR(50) PRIMARY KEY
    std::string email;                     // VARCHAR(100) UNIQUE NOT NULL
    std::string name;                      // VARCHAR(100) NOT NULL
    std::string password_hash;             // TEXT NOT NULL
    std::optional<int32_t> personal_node_id; // REFERENCES organization_nodes(node_id)
    Timestamp create_at;                   // DEFAULT CURRENT_TIMESTAMP
};