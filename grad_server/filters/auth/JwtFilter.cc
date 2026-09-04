/**
 *
 *  JwtFilter.cc
 *
 */

#include "JwtFilter.h"
#include <jwt-cpp/jwt.h>
#include <drogon/HttpAppFramework.h>

using namespace drogon;

namespace {
void addCorsHeaders(const HttpResponsePtr &res) {
    res->addHeader("Access-Control-Allow-Origin", "*");
    res->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
}
}

void JwtFilter::doFilter(const HttpRequestPtr &req,
                         FilterCallback &&fcb,
                         FilterChainCallback &&fccb)
{
    //Edit your logic here

    // 1. 헤더에서 Authorization 읽기
    auto &authHeader = req->getHeader("Authorization");

    // 2. Bearer 토큰 형식 검사 (비어있거나 "Bearer "로 시작하지 않으면 탈락)
    if (authHeader.empty() || authHeader.compare(0, 7, "Bearer ") != 0)
    {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "401";
        ret["message"] = "로그인이 필요한 서비스입니다.";
        
        auto res = HttpResponse::newHttpJsonResponse(ret);
        res->setStatusCode(k401Unauthorized);
        addCorsHeaders(res);
        fcb(res);
        return;
    }

    // 3. 토큰 추출 및 검증 로직
    std::string token = authHeader.substr(7);
    auto secret = app().getCustomConfig()["app"]["jwt_secret"].asString();

    try {
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{secret})
            .with_issuer("grad_server");

        auto decoded = jwt::decode(token);
        verifier.verify(decoded);

        // 검증 성공 시 정보 주입
        std::string userEmail = decoded.get_payload_claim("user_email").as_string();
        req->attributes()->insert("user_email", userEmail);

        
        //Passed
        fccb();
        return;
    } 
    catch (const std::exception &e){
        //Check failed
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "401";
        ret["message"] = "유효하지 않거나 만료된 토큰입니다.";

        auto res = drogon::HttpResponse::newHttpJsonResponse(ret);
        res->setStatusCode(k401Unauthorized);
<<<<<<< Updated upstream
=======
        addCorsHeaders(res);
>>>>>>> Stashed changes
        fcb(res);
    }
}
