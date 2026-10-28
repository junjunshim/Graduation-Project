/**
 *
 *  JwtFilter.cc
 *
 */

#include "JwtFilter.h"
#include "LogContext.h"
#include <jwt-cpp/jwt.h>
#include <drogon/HttpAppFramework.h>

using namespace drogon;

namespace {
void addAuthResponseHeaders(const HttpRequestPtr &req, const HttpResponsePtr &res) {
    res->addHeader(app_utils::kRequestIdHeader, app_utils::ensureRequestId(req));
    res->addHeader("Access-Control-Allow-Origin", "*");
    res->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Request-ID");
    res->addHeader("Access-Control-Expose-Headers", "X-Request-ID");
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
        LOG_WARN << "[AUTH] event=auth.rejected " << app_utils::requestIdTag(app_utils::ensureRequestId(req))
                 << " reason=missing_bearer path="
                 << app_utils::sanitizeLogValue(std::string(req->path()), 512);

        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "401";
        ret["message"] = "로그인이 필요한 서비스입니다.";
        
        auto res = HttpResponse::newHttpJsonResponse(ret);
        res->setStatusCode(k401Unauthorized);
        addAuthResponseHeaders(req, res);
        fcb(res);
        return;
    }

    // 3. 토큰 추출 및 검증 로직
    std::string token = authHeader.substr(7);
    auto secret = app().getCustomConfig()["jwt_secret"].asString();

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
        LOG_WARN << "[AUTH] event=auth.rejected " << app_utils::requestIdTag(app_utils::ensureRequestId(req))
                 << " reason=invalid_token path="
                 << app_utils::sanitizeLogValue(std::string(req->path()), 512)
                 << " error=" << app_utils::sanitizeLogValue(e.what(), 256);

        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "401";
        ret["message"] = "유효하지 않거나 만료된 토큰입니다.";

        auto res = drogon::HttpResponse::newHttpJsonResponse(ret);
        res->setStatusCode(k401Unauthorized);
        addAuthResponseHeaders(req, res);
        fcb(res);
    }
}
