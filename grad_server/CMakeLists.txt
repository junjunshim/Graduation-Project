cmake_minimum_required(VERSION 3.5)
project(grad_server CXX)

include(CheckIncludeFileCXX)

check_include_file_cxx(any HAS_ANY)
check_include_file_cxx(string_view HAS_STRING_VIEW)
check_include_file_cxx(coroutine HAS_COROUTINE)
if (NOT "${CMAKE_CXX_STANDARD}" STREQUAL "")
    # Do nothing
elseif (HAS_ANY AND HAS_STRING_VIEW AND HAS_COROUTINE)
    set(CMAKE_CXX_STANDARD 20)
elseif (HAS_ANY AND HAS_STRING_VIEW)
    set(CMAKE_CXX_STANDARD 17)
else ()
    set(CMAKE_CXX_STANDARD 14)
endif ()

set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(${PROJECT_NAME} main.cc)

# ##############################################################################
# If you include the drogon source code locally in your project, use this method
# to add drogon 
# add_subdirectory(drogon) 
# target_link_libraries(${PROJECT_NAME} PRIVATE drogon)
#
# and comment out the following lines
find_package(Drogon CONFIG REQUIRED)
target_link_libraries(${PROJECT_NAME} PRIVATE Drogon::Drogon)

# ##############################################################################

if (CMAKE_CXX_STANDARD LESS 17)
    message(FATAL_ERROR "c++17 or higher is required")
elseif (CMAKE_CXX_STANDARD LESS 20)
    message(STATUS "use c++17")
else ()
    message(STATUS "use c++20")
endif ()

aux_source_directory(controllers/auth CTL_AUTH_SRC)
aux_source_directory(controllers/node CTL_NODE_SRC)
aux_source_directory(controllers/work CTL_WORK_SRC)
aux_source_directory(controllers/role CTL_ROLE_SRC)
aux_source_directory(controllers/context CTL_CONTEXT_SRC)
aux_source_directory(controllers/notification CTL_NOTIFICATION_SRC)
set(CTL_SRC ${CTL_AUTH_SRC} ${CTL_NODE_SRC} ${CTL_WORK_SRC} ${CTL_ROLE_SRC} ${CTL_CONTEXT_SRC} ${CTL_NOTIFICATION_SRC})

aux_source_directory(filters/auth FILTER_SRC)
aux_source_directory(plugins PLUGIN_SRC)

aux_source_directory(models/auth MODEL_AUTH_SRC)
aux_source_directory(models/node MODEL_NODE_SRC)
aux_source_directory(models/work MODEL_WORK_SRC)
aux_source_directory(models/role MODEL_ROLE_SRC)
set(MODEL_SRC ${MODEL_AUTH_SRC} ${MODEL_NODE_SRC} ${MODEL_WORK_SRC} ${MODEL_ROLE_SRC})

aux_source_directory(utils/common UTIL_SRC)

drogon_create_views(${PROJECT_NAME} ${CMAKE_CURRENT_SOURCE_DIR}/views
                    ${CMAKE_CURRENT_BINARY_DIR})
# use the following line to create views with namespaces.
# drogon_create_views(${PROJECT_NAME} ${CMAKE_CURRENT_SOURCE_DIR}/views
#                     ${CMAKE_CURRENT_BINARY_DIR} TRUE)
# use the following line to create views with namespace CHANGE_ME prefixed
# and path namespaces.
# drogon_create_views(${PROJECT_NAME} ${CMAKE_CURRENT_SOURCE_DIR}/views
#                     ${CMAKE_CURRENT_BINARY_DIR} TRUE CHANGE_ME)

target_include_directories(${PROJECT_NAME}
                           PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}
                                   ${CMAKE_CURRENT_SOURCE_DIR}/controllers/auth
                                   ${CMAKE_CURRENT_SOURCE_DIR}/controllers/node
                                   ${CMAKE_CURRENT_SOURCE_DIR}/controllers/work
                                   ${CMAKE_CURRENT_SOURCE_DIR}/controllers/role
                                   ${CMAKE_CURRENT_SOURCE_DIR}/controllers/context
                                   ${CMAKE_CURRENT_SOURCE_DIR}/controllers/notification
                                   ${CMAKE_CURRENT_SOURCE_DIR}/filters/auth
                                   ${CMAKE_CURRENT_SOURCE_DIR}/models/auth
                                   ${CMAKE_CURRENT_SOURCE_DIR}/models/node
                                   ${CMAKE_CURRENT_SOURCE_DIR}/models/work
                                   ${CMAKE_CURRENT_SOURCE_DIR}/models/role
                                   ${CMAKE_CURRENT_SOURCE_DIR}/utils/common)
target_sources(${PROJECT_NAME}
               PRIVATE
               ${SRC_DIR}
               ${CTL_SRC}
               ${FILTER_SRC}
               ${PLUGIN_SRC}
               ${MODEL_SRC}
               ${UTIL_SRC})
# ##############################################################################
# uncomment the following line for dynamically loading views 
# set_property(TARGET ${PROJECT_NAME} PROPERTY ENABLE_EXPORTS ON)

# ##############################################################################

add_subdirectory(test)
