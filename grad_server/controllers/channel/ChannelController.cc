#include "ChannelController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include <json/json.h>
#include <optional>
#include <filesystem>
#include <algorithm>
#include <cctype>
#include <memory>
#include <drogon/utils/Utilities.h>

using namespace api;
using namespace app_utils;

namespace {

std::string inferMimeType(const std::string &filename) {
    auto dotPos = filename.find_last_of('.');
    if (dotPos == std::string::npos) {
        return "application/octet-stream";
    }
    std::string ext = filename.substr(dotPos);
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    if (ext == ".png") return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".gif") return "image/gif";
    if (ext == ".webp") return "image/webp";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".pdf") return "application/pdf";
    if (ext == ".txt" || ext == ".md" || ext == ".log") return "text/plain";
    if (ext == ".json") return "application/json";
    if (ext == ".csv") return "text/csv";
    if (ext == ".zip") return "application/zip";
    return "application/octet-stream";
}

drogon::ContentType toDrogonContentType(const std::string &mime) {
    if (mime == "image/png") return CT_IMAGE_PNG;
    if (mime == "image/jpeg") return CT_IMAGE_JPG;
    if (mime == "image/gif") return CT_IMAGE_GIF;
    if (mime == "image/webp") return CT_IMAGE_WEBP;
    if (mime == "image/svg+xml") return CT_IMAGE_SVG_XML;
    if (mime == "application/pdf") return CT_APPLICATION_PDF;
    if (mime == "text/plain") return CT_TEXT_PLAIN;
    if (mime == "application/json") return CT_APPLICATION_JSON;
    return CT_APPLICATION_OCTET_STREAM;
}

// 업로드 파일명에서 디렉터리 성분과 제어 문자를 제거한다. 실제 저장 이름은 UUID로 만들지만,
// 원본 이름은 DB·다운로드 응답에 그대로 쓰이므로 여기서 정리한다.
std::string sanitizeUploadFileName(const std::string &raw) {
    std::string name = raw;
    const auto slashPos = name.find_last_of("/\\");
    if (slashPos != std::string::npos) {
        name.erase(0, slashPos + 1);
    }
    name.erase(std::remove_if(name.begin(), name.end(),
                              [](unsigned char c) { return c < 0x20 || c == 0x7f; }),
               name.end());
    while (!name.empty() && (name.front() == ' ' || name.front() == '\t')) {
        name.erase(name.begin());
    }
    while (!name.empty() && (name.back() == ' ' || name.back() == '\t')) {
        name.pop_back();
    }
    if (name.empty() || name == "." || name == "..") {
        name = "file";
    }
    if (name.size() > 255) {
        name = name.substr(name.size() - 255);
    }
    return name;
}

// 저장 파일명에 붙일 확장자만 추출한다. 영문/숫자 1~10자만 허용하고, 그 외에는 false를 돌려준다.
bool extractSafeExtension(const std::string &fileName, std::string &extension) {
    extension.clear();
    const auto dotPos = fileName.find_last_of('.');
    if (dotPos == std::string::npos) {
        return true;
    }

    std::string candidate = fileName.substr(dotPos + 1);
    if (candidate.empty() || candidate.size() > 10) {
        return false;
    }
    if (!std::all_of(candidate.begin(), candidate.end(),
                     [](unsigned char c) { return std::isalnum(c) != 0; })) {
        return false;
    }

    std::transform(candidate.begin(), candidate.end(), candidate.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    extension = "." + candidate;
    return true;
}

bool isPathWithin(const std::filesystem::path &root, const std::filesystem::path &candidate) {
    const auto relative = candidate.lexically_relative(root);
    if (relative.empty()) {
        return false;
    }
    const std::string parentPrefix = ".." + std::string(1, std::filesystem::path::preferred_separator);
    return relative != ".." && relative.native().rfind(parentPrefix, 0) != 0;
}

} // namespace

// 1. GET /api/channels/sidebar
void ChannelController::getSidebar(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    auto dbClient = drogon::app().getDbClient();

    dbClient->execSqlAsync(
        "SELECT * FROM get_user_chat_sidebar($1)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email
    );
}

// 2. POST /api/channels
void ChannelController::createChannel(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "name") || (!jsonPtr->isMember("node_id") && !jsonPtr->isMember("owner_node_id"))) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(node_id, name)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int node_id = jsonPtr->isMember("node_id") ? (*jsonPtr)["node_id"].asInt() : (*jsonPtr)["owner_node_id"].asInt();
    std::string name = (*jsonPtr)["name"].asString();
    std::string description = (jsonPtr->isMember("description") && !(*jsonPtr)["description"].isNull())
        ? (*jsonPtr)["description"].asString()
        : "";
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM create_workspace_channel($1, $2, $3, $4)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, node_id, name, description
    );
}

// 3. PATCH /api/channels
void ChannelController::updateChannel(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!validateInts(jsonPtr, "channel_id")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(channel_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int channel_id = (*jsonPtr)["channel_id"].asInt();
    std::string name = (jsonPtr->isMember("name") && !(*jsonPtr)["name"].isNull()) ? (*jsonPtr)["name"].asString() : "";
    std::optional<std::string> description = std::nullopt;
    if (jsonPtr->isMember("description") && !(*jsonPtr)["description"].isNull()) {
        description = (*jsonPtr)["description"].asString();
    }
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM update_workspace_channel($1, $2, $3, $4)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, channel_id, name, description
    );
}

// 4. DELETE /api/channels
void ChannelController::deleteChannel(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    int channel_id = 0;
    if (validateInts(jsonPtr, "channel_id")) {
        channel_id = (*jsonPtr)["channel_id"].asInt();
    } else {
        std::string param = req->getParameter("channel_id");
        if (!param.empty()) {
            try { channel_id = std::stoi(param); } catch (...) { channel_id = 0; }
        }
    }

    if (channel_id <= 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(channel_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM delete_workspace_channel($1, $2)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, channel_id
    );
}

// 5. POST /api/channels/dm
void ChannelController::openOrCreateDm(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || (!validateStrings(jsonPtr, "target_email") && !validateStrings(jsonPtr, "email"))) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(target_email)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string target_email = jsonPtr->isMember("target_email")
        ? (*jsonPtr)["target_email"].asString()
        : (*jsonPtr)["email"].asString();
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM open_or_create_dm_channel($1, $2)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, target_email
    );
}

// 6. GET /api/channels/messages
void ChannelController::getMessages(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string channel_id_str = req->getParameter("channel_id");
    if (channel_id_str.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 쿼리 파라미터(channel_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int channel_id = 0;
    try { channel_id = std::stoi(channel_id_str); } catch (...) { channel_id = 0; }
    if (channel_id <= 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "유효하지 않은 channel_id입니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::optional<int> before_message_id = std::nullopt;
    std::string before_str = req->getParameter("before_message_id");
    if (!before_str.empty()) {
        try {
            int val = std::stoi(before_str);
            if (val > 0) before_message_id = val;
        } catch (...) {}
    }

    int limit = 100;
    std::string limit_str = req->getParameter("limit");
    if (!limit_str.empty()) {
        try { limit = std::stoi(limit_str); } catch (...) {}
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM get_channel_messages($1, $2, $3, $4)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, channel_id, before_message_id, limit
    );
}

// 7. GET /api/channels/threads
void ChannelController::getThreadMessages(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string parent_id_str = req->getParameter("parent_message_id");
    if (parent_id_str.empty()) {
        parent_id_str = req->getParameter("message_id");
    }
    if (parent_id_str.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 쿼리 파라미터(parent_message_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int parent_message_id = 0;
    try { parent_message_id = std::stoi(parent_id_str); } catch (...) { parent_message_id = 0; }
    if (parent_message_id <= 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "유효하지 않은 parent_message_id입니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM get_thread_messages($1, $2)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, parent_message_id
    );
}

// 8. POST /api/channels/messages
void ChannelController::createMessage(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!validateInts(jsonPtr, "channel_id")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(channel_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int channel_id = (*jsonPtr)["channel_id"].asInt();
    std::optional<int> parent_message_id = std::nullopt;
    if (jsonPtr->isMember("parent_message_id") && (*jsonPtr)["parent_message_id"].isInt()) {
        int val = (*jsonPtr)["parent_message_id"].asInt();
        if (val > 0) parent_message_id = val;
    }

    std::string content = (jsonPtr->isMember("content") && !(*jsonPtr)["content"].isNull())
        ? (*jsonPtr)["content"].asString()
        : "";
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM create_chat_message($1, $2, $3, $4)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, channel_id, parent_message_id, content
    );
}

// 9. PATCH /api/channels/messages
void ChannelController::updateMessage(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!validateInts(jsonPtr, "message_id") || !validateStrings(jsonPtr, "content")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(message_id, content)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int message_id = (*jsonPtr)["message_id"].asInt();
    std::string content = (*jsonPtr)["content"].asString();
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM update_chat_message($1, $2, $3)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, message_id, content
    );
}

// 10. DELETE /api/channels/messages
void ChannelController::deleteMessage(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    int message_id = 0;
    if (validateInts(jsonPtr, "message_id")) {
        message_id = (*jsonPtr)["message_id"].asInt();
    } else {
        std::string param = req->getParameter("message_id");
        if (!param.empty()) {
            try { message_id = std::stoi(param); } catch (...) { message_id = 0; }
        }
    }

    if (message_id <= 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(message_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM delete_chat_message($1, $2)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, message_id
    );
}

// 11. POST /api/channels/files/upload
void ChannelController::uploadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto parser = std::make_shared<MultiPartParser>();
    if (parser->parse(req) != 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "파일 업로드 요청 파싱에 실패했습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    auto &files = parser->getFiles();
    auto &parameters = parser->getParameters();

    auto itMsgId = parameters.find("message_id");
    if (itMsgId == parameters.end() || itMsgId->second.empty() || files.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(message_id) 또는 업로드할 파일이 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int message_id = 0;
    try { message_id = std::stoi(itMsgId->second); } catch (...) { message_id = 0; }
    if (message_id <= 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "유효하지 않은 message_id입니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    const auto &uploadFile = files[0];

    const std::string original_file_name = sanitizeUploadFileName(uploadFile.getFileName());
    std::string extension;
    if (!extractSafeExtension(original_file_name, extension)) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "허용되지 않는 파일 확장자입니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    const size_t file_size = uploadFile.fileLength();
    const std::string mime_type = inferMimeType(original_file_name);
    const std::string stored_file_name = drogon::utils::getUuid() + extension;

    const auto sendError = [callback](drogon::HttpStatusCode status, const std::string &message) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = message;
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(status);
        callback(resp);
    };

    // 파일을 저장하기 전에 서버가 실제 channel_id를 확정하고 작성자·채널 권한을 검사한다.
    // 클라이언트가 보낸 channel_id는 경로에 사용하지 않는다.
    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM get_chat_message_upload_target($1, $2)",
        [callback, sendError, parser, original_file_name, stored_file_name, file_size, mime_type,
         requester_email, req](const orm::Result &result) {
            Json::Value parsed = parseIntegratedDataResult(result);
            if (!parsed["data"].isArray() || parsed["data"].empty()) {
                sendError(k404NotFound, "업로드 대상 메시지를 찾을 수 없습니다.");
                return;
            }

            const auto target = parsed["data"][0];
            const int channel_id = target["channel_id"].asInt();
            const int resolved_message_id = target["message_id"].asInt();
            if (channel_id <= 0 || resolved_message_id <= 0) {
                sendError(k500InternalServerError, "업로드 경로를 결정하지 못했습니다.");
                return;
            }

            std::filesystem::path fullPath;
            try {
                const auto root = std::filesystem::weakly_canonical("./uploads/channels");
                const auto uploadDir = root / std::to_string(channel_id) / std::to_string(resolved_message_id);
                std::filesystem::create_directories(uploadDir);
                fullPath = std::filesystem::weakly_canonical(uploadDir / stored_file_name);
                if (!isPathWithin(root, fullPath)) {
                    sendError(k400BadRequest, "유효하지 않은 업로드 경로입니다.");
                    return;
                }
            } catch (const std::exception &e) {
                LOG_ERROR << "Failed to prepare channel upload directory: " << e.what();
                sendError(k500InternalServerError, "업로드 디렉터리를 준비하지 못했습니다.");
                return;
            }

            if (parser->getFiles().front().saveAs(fullPath.string()) != 0) {
                sendError(k500InternalServerError, "파일 저장 중 오류가 발생했습니다.");
                return;
            }

            // DB에는 CWD 기준 상대 경로를 남긴다. 정리 스케줄러가 uploads/ 접두사로 관리 경로를 판정한다.
            const auto relativePath = std::filesystem::path("./uploads/channels") /
                                       std::to_string(channel_id) / std::to_string(resolved_message_id) /
                                       stored_file_name;
            const std::string savedPath = relativePath.generic_string();
            auto innerDbClient = drogon::app().getDbClient();
            innerDbClient->execSqlAsync(
                "SELECT * FROM add_chat_message_file($1, $2, $3, $4, $5, $6, $7)",
                [callback](const orm::Result &addResult) {
                    Json::Value ret = parseAndDispatchChatResult(addResult);
                    auto resp = HttpResponse::newHttpJsonResponse(ret);
                    resp->setStatusCode(k201Created);
                    callback(resp);
                },
                [callback, savedPath, req](const orm::DrogonDbException &e) {
                    std::error_code removeError;
                    std::filesystem::remove(savedPath, removeError);

                    Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
                    auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
                    ret.removeMember("http_code");
                    auto resp = HttpResponse::newHttpJsonResponse(ret);
                    resp->setStatusCode(statusCode);
                    callback(resp);
                },
                requester_email, resolved_message_id, original_file_name, stored_file_name, savedPath,
                static_cast<int64_t>(file_size), mime_type);
        },
        [sendError, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            sendError(statusCode, ret.isMember("message") ? ret["message"].asString()
                                                            : "업로드 권한을 확인하지 못했습니다.");
        },
        requester_email, message_id);
}

// 12. GET /api/channels/files/download
void ChannelController::downloadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string file_id_str = req->getParameter("file_id");
    if (file_id_str.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 쿼리 파라미터(file_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int file_id = 0;
    try { file_id = std::stoi(file_id_str); } catch (...) { file_id = 0; }
    if (file_id <= 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "유효하지 않은 file_id입니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string inline_param = req->getParameter("inline");
    bool is_inline = (inline_param == "1" || inline_param == "true");
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM get_chat_file_for_download($1, $2)",
        [callback, is_inline](const orm::Result &result) {
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "파일을 찾을 수 없습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k404NotFound);
                callback(resp);
                return;
            }

            Json::Value parsed = parseIntegratedDataResult(result);
            auto fileData = parsed["data"][0];
            std::string file_path = fileData["file_path"].asString();
            std::string original_file_name = fileData["original_file_name"].asString();
            std::string mime_type = fileData.isMember("mime_type") && !fileData["mime_type"].isNull()
                ? fileData["mime_type"].asString()
                : inferMimeType(original_file_name);

            if (!std::filesystem::exists(file_path)) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "서버 디스크에 해당 파일이 존재하지 않습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k404NotFound);
                callback(resp);
                return;
            }

            bool serve_inline = is_inline || mime_type.rfind("image/", 0) == 0;
            auto contentType = toDrogonContentType(mime_type);
            if (serve_inline) {
                auto resp = HttpResponse::newFileResponse(file_path, "", contentType);
                resp->addHeader("Content-Disposition", "inline; filename=\"" + original_file_name + "\"");
                callback(resp);
            } else {
                auto resp = HttpResponse::newFileResponse(file_path, original_file_name, contentType);
                callback(resp);
            }
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, file_id
    );
}

// 13. POST /api/channels/read
void ChannelController::markAsRead(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!validateInts(jsonPtr, "channel_id")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(channel_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int channel_id = (*jsonPtr)["channel_id"].asInt();
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM mark_channel_as_read($1, $2)",
        [callback](const orm::Result &result) {
            Json::Value ret = parseAndDispatchChatResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, channel_id
    );
}
