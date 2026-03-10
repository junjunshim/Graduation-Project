cmake_minimum_required(VERSION 3.10)
project(GraduationProject)

# C++ 17 표준 설정 (Drogon 필수 사양)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1. 헤더 파일 경로 설정 (우리가 만든 .h 파일들)
include_directories(${CMAKE_SOURCE_DIR}/include)

# 2. 내부 lib 폴더 경로 설정 (프로젝트 내부 바이너리 라이브러리)
# CMAKE_SOURCE_DIR는 프로젝트 최상위 루트 경로를 의미
set(PROJECT_LIB_DIR ${CMAKE_SOURCE_DIR}/lib)
link_directories(${PROJECT_LIB_DIR})

# 3. 백엔드 소스 폴더 연결
add_subdirectory(src/backend)