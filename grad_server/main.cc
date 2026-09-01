#include <drogon/drogon.h>
#include <json/json.h>
#include <fstream>
#include <iostream>
#include <cstdlib>

int main() {
    // 1. 기본 설정 파일 경로
    std::string configPath = "/app/grad_server/config.json";

    // 2. 환경 변수 읽기
    auto getEnv = [](const char* key, const std::string& fallback) {
        const char* value = std::getenv(key);
        return (value && strlen(value) > 0) ? std::string(value) : fallback;
    };

    // 3. Json 설정 덮어쓰기
    try{
        std::ifstream ifs(configPath);
        Json::Value config;
        ifs >> config;

        // DB 설정 덮어쓰기
        if(config.isMember("db_clients") && config["db_clients"].isArray() && !config["db_clients"].empty()){
            auto& db = config["db_clients"][0];
            db["host"] = getEnv("DB_HOST", db["host"].asString());
            db["port"] = std::stoi(getEnv("DB_PORT", db["port"].asString()));
            db["dbname"] = getEnv("DB_NAME", db["dbname"].asString());
            db["user"] = getEnv("DB_USER", db["user"].asString());
            db["passwd"] = getEnv("DB_PASSWORD", db["passwd"].asString());
        }

        // jwt 설정 덮어쓰기
        if(config.isMember("custom_config")){
            auto& custom = config["custom_config"];
            custom["jwt_secret"] = getEnv("JWT_SECRET", custom["jwt_secret"].asString());
            custom["access_token_expiry"]  = std::stoi(getEnv("ACCESS_TOKEN_EXPIRY", std::to_string(custom["access_token_expiry"].asInt())));
            custom["refresh_token_expiry"] = std::stoi(getEnv("REFRESH_TOKEN_EXPIRY", std::to_string(custom["refresh_token_expiry"].asInt())));
        }

        drogon::app().loadConfigJson(config);
    } catch (const std::exception& e) {
        LOG_ERROR << "Error loading configuration: " << e.what();
        return 1;
    }

    // 2. 서버 접속 테스트용 핸들러 등록
    drogon::app().registerHandler("/server-test", [](const drogon::HttpRequestPtr&, std::function<void (const drogon::HttpResponsePtr &)> &&callback) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setBody("TEST => Server is running ");
        callback(resp);
    });
    LOG_INFO << "Server testing handler";
    
    // 3. DB 접속 테스트용 핸들러 등록
    drogon::app().registerHandler("/db-test", [](const drogon::HttpRequestPtr& req, std::function<void (const drogon::HttpResponsePtr &)> &&callback) {
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


    // CORS 허용 설정 (모든 도메인 및 포트 허용)
    drogon::app().registerPostHandlingAdvice([](const drogon::HttpRequestPtr &req, const drogon::HttpResponsePtr &resp) {
        resp->addHeader("Access-Control-Allow-Origin", "*"); // 모든 도메인 허용
        resp->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
        resp->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    });

    // OPTIONS 요청(Preflight) 처리를 위한 간단한 처리
    drogon::app().registerPreRoutingAdvice([](const drogon::HttpRequestPtr &req, drogon::AdviceCallback &&acb, drogon::AdviceChainCallback &&accb) {
        if (req->method() == drogon::Options) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->addHeader("Access-Control-Allow-Origin", "*");
            resp->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
            resp->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
            resp->setStatusCode(drogon::k200OK);
            acb(resp);
            return;
        }
        accb();
    });

    //Run HTTP framework,the method will block in the internal event loop
    drogon::app().run();
    return 0;
}
