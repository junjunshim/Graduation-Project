#include <drogon/drogon.h>
#include <iostream>
#include <cstdlib>

int main() {
    // 1. 환경 변수에서 DB 설정 읽어오기
    std::string dbHost = std::getenv("DB_HOST") ? std::getenv("DB_HOST") : "db";
    std::string dbPort = std::getenv("DB_PORT") ? std::getenv("DB_PORT") : "5432";
    std::string dbName = std::getenv("DB_NAME") ? std::getenv("DB_NAME") : "grad_db";
    std::string dbUser = std::getenv("DB_USER") ? std::getenv("DB_USER") : "admin";
    std::string dbPass = std::getenv("DB_PASSWORD") ? std::getenv("DB_PASSWORD") : "admin123";

    // 2. DB 연결 설정 (PostgreSQL)
    drogon::app().createDbClient("postgresql", dbHost, std::stoi(dbPort), dbName, dbUser, dbPass);
    
    LOG_INFO << "Connecting to Database at " << dbHost << ":" << dbPort;

    // 3. 서버 실행 포트 및 호스트 설정 (0.0.0.0으로 해야 컨테이너 밖에서 접속 가능)
    drogon::app().addListener("0.0.0.0", 8080);

    LOG_INFO << "Server is running on http://localhost:8080";

    // 5. 서버 가동
    drogon::app().run();

    return 0;
}