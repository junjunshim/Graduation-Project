#include <drogon/drogon.h>
#include <iostream>
#include <cstdlib>

int main() {
    // 1. 설정 파일 로드(config.yaml)
    drogon::app().loadConfigFile("/app/output.yaml");
    LOG_INFO << "Server is starting based on config.json...";

    // 2. 서버 접속 테스트용 핸들러 등록
    drogon::app().registerHandler("/server-test", [](const drogon::HttpRequestPtr&, 
                                        std::function<void (const drogon::HttpResponsePtr &)> &&callback) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setBody("TEST => Server is running ");
        callback(resp);
    });
    LOG_INFO << "Server testing handler";
    
    // 3. DB 접속 테스트용 핸들러 등록
    drogon::app().registerHandler("/db-test", [](const drogon::HttpRequestPtr& req, 
                                                std::function<void (const drogon::HttpResponsePtr &)> &&callback) {
        auto dbClient = drogon::app().getDbClient(); // 'default' 클라이언트 호출

        // PostgreSQL에 현재 시간을 물어보는 단순 쿼리 실행
        dbClient->execSqlAsync(
            "SELECT now() as current_time",
            [callback](const drogon::orm::Result &result) {
                auto now = result[0]["current_time"].as<std::string>();
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->setBody("DB Connection Success! DB Current Time: " + now);
                callback(resp);
            },
            [callback](const drogon::orm::DrogonDbException &e) {
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->setStatusCode(drogon::k500InternalServerError);
                resp->setBody("DB Connection Failed! Error: " + std::string(e.base().what()));
                callback(resp);
            }
        );
    });
    LOG_INFO << "Database teseting handler";


    // 4. 서버 가동
    drogon::app().run();
    
    return 0;
}   