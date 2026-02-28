# 📄 cmake 관련 파일 설명서 및 사용법

## 1. CMakeLists.txt 설명서

### 1) root CMakeLists.txt
루트 디렉터리에 있는 CMakeList.txt 파일은 프로젝트 전체 환경과 하위 폴더들을  통합하여 관리

---
 - **cmake_minimum_required(VERSION 3.10)** => 최소한 CMake 3.10 버전 이상
 - **project(GraduationProject)** => 프로젝트의 이름을 설정
 - **set(CMAKE_CXX_STANDARD 17) \
    set(CMAKE_CXX_STANDARD_REQUIRED ON)** => C++ 17 버전을 사용 및 해당 버전이 없으면 빌드 중단
 - **include_directories(include)** => 사용자 지정 라이브러리의 디렉터리 위치 지정
 - **set(PROJECT_LIB_DIR \${CMAKE_SOURCE_DIR}/lib)  
    link_directories(${PROJECT_LIB_DIR})** => 외부 바이너리 라이브러리 파일 링크
 - **add_subdirectory(src/backend)** => 실제 소스 코드 위치 지정
---
### 2) src/backend CMakeLists.txt
실제 서버 프로그램을 만드는 로직 \
root CMakeLists.txt의 마지막 라인을 통해서 해당 CMakeLists.txt가 적용된다.
 - **set(BINARY_NAME "grad_server")** => 최종적으로 생성될 실행 파일 이름
 - **set(SOURCE_FILES main.cc)** => 컴파일 해야할 소스 코드들 지정 \
 ex) controller.cc 추가 시, set(SOURCE_FILES main.cc controller.cc) 이런식으로 추가
 - **find_package(Drogon REQUIRED) \
    find_package(Jsoncpp REQUIRED) \
    find_package(ZLIB REQUIRED)** => docker에서 설치한 drogon 관련 패키지 불러오기
 - **find_package(PostgreSQL REQUIRED)** => docker에서 설치한 PostgreSQL 관련 패키지 불러오기
 - **add_executable(\${BINARY_NAME} ${SOURCE_FILES})** => 소스 파일을 이용하여 실행 파일 생성
 - **target_link_libraries(${BINARY_NAME}\
    PRIVATE \
    Drogon::Drogon \
    PostgreSQL::PostgreSQL \
    )** => 실행 파일에 drogon, postgreSQL 기능을 링크 \
    ex) 외부 라이브러리 사용 시, lib 디렉터리에 있는 라이브러리를 여기에 추가
 - **target_include_directories(\${BINARY_NAME} PRIVATE{$PostgreSQL_INCLUDE_DIRS})** => 실행 파일을 만들 때, PostegreSQL 라이브러리 헤더 파일 위치를 참조
---
## 2. cmake 사용법
우리 프로젝트에서는 api 서버와 db를 docker를 통하여 컨테이너에서 작동된다. \
따라서 api 서버 빌드를 위해서는 생성된 컨테이너 내부에서 빌드를 진행해야한다.

- [docker_manual.md](../docker/docker_manual.md)에 있는 방식으로 컨테이너를 생성한다.
- 컨테이너 생성 후, 처음 빌드한다면 아래 명령어 입력(파일 추가 및 삭제, 라이브러리 변경 같은 경우 아래 방식으로 해야함)

```cmd
docker exec -it grad_backend /bin/bash   #컨테이너 접속

mkdir build && cd build     #빌드 폴더 생성 및 이동

cmake ..    #cmake로 빌드
make

./src/backend/grad_server   #생성된 서버 실행 파일 실행
```

- 이후 코드 수정 후, 다시 실행하는 방법(기존 파일의 내용을 수정했을 경우)
```cmd
docker exec -it grad_backend /bin/bash
cd build
make
./src/backend/grad_server
```

- 서버 중지 방법
ctrl + c를 통해서 서버 중지 후, exit으로 컨테이너에서 나올 수 있다.




