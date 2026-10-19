#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
class ChannelController : public drogon::HttpController<ChannelController>
{
  public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ChannelController::getSidebar, "/api/channels/sidebar", Get, "JwtFilter");
    ADD_METHOD_TO(ChannelController::createChannel, "/api/channels", Post, "JwtFilter");
    ADD_METHOD_TO(ChannelController::updateChannel, "/api/channels", Patch, "JwtFilter");
    ADD_METHOD_TO(ChannelController::deleteChannel, "/api/channels", Delete, "JwtFilter");
    ADD_METHOD_TO(ChannelController::openOrCreateDm, "/api/channels/dm", Post, "JwtFilter");
    ADD_METHOD_TO(ChannelController::getMessages, "/api/channels/messages", Get, "JwtFilter");
    ADD_METHOD_TO(ChannelController::getThreadMessages, "/api/channels/threads", Get, "JwtFilter");
    ADD_METHOD_TO(ChannelController::createMessage, "/api/channels/messages", Post, "JwtFilter");
    ADD_METHOD_TO(ChannelController::updateMessage, "/api/channels/messages", Patch, "JwtFilter");
    ADD_METHOD_TO(ChannelController::deleteMessage, "/api/channels/messages", Delete, "JwtFilter");
    ADD_METHOD_TO(ChannelController::uploadFile, "/api/channels/files/upload", Post, "JwtFilter");
    ADD_METHOD_TO(ChannelController::downloadFile, "/api/channels/files/download", Get, "JwtFilter");
    ADD_METHOD_TO(ChannelController::markAsRead, "/api/channels/read", Post, "JwtFilter");
    METHOD_LIST_END

    void getSidebar(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void createChannel(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void updateChannel(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void deleteChannel(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void openOrCreateDm(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void getMessages(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void getThreadMessages(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void createMessage(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void updateMessage(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void deleteMessage(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void uploadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void downloadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void markAsRead(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
};
}
