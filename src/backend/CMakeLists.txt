# 1. 생성될 실행 파일 이름
set(BINARY_NAME "grad_server")

# 2. 컴파일할 소스 파일 자동 스캔
file(GLOB_RECURSE ALL_SOURCES 
    "main.cc"
    "controllers/*.cc"
)

# 3. 시스템에 설치된 필수 패키지 찾기 (Drogon 및 의존성)
find_package(Drogon REQUIRED)
find_package(Jsoncpp REQUIRED)
# find_package(UUID REQUIRED)
find_package(ZLIB REQUIRED)

# 4. PostgreSQL 찾기 (CMake 공식 방식)
find_package(PostgreSQL REQUIRED)

# 5. 실행 파일 생성 명령
add_executable(${BINARY_NAME} ${ALL_SOURCES})

# 6. 라이브러리 합체 (Linking)
# - Drogon::Drogon: 서버 엔진
# - PostgreSQL::PostgreSQL: DB 접속 엔진
# - 만약 lib 폴더 내 특정 파일(예: libcustom.a)을 쓴다면 'custom' 추가
target_link_libraries(${BINARY_NAME} 
    PRIVATE 
    Drogon::Drogon
    PostgreSQL::PostgreSQL
)

# 7. PostgreSQL 헤더 파일 경로 포함
target_include_directories(${BINARY_NAME} PRIVATE ${PostgreSQL_INCLUDE_DIRS})