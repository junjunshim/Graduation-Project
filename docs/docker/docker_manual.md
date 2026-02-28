# 📄 docker 관련 파일 설명서

## 컨테이너 전체 구조
우리 시스템은 두개의 컨테이너로 연결된 구조
1. Backend : C++ Drogon 프레임워크 기반 api 서버
2. Database : PostgreSQL 15 기반 데이터베이스

## 1. docker-compose.yml
이 파일은 여러 컨테이너를 동시에 실행하고 서로 연결해주는 설계도

---
### DB 컨테이너 설정
- **image: postgres:15** => postgres 15 가져오기
- **container_name: grad_postgres** => 컨테이너 이름 설정
- **restart: always** => 컨테이너가 다운되었을 때, 자동으로 다시 살리는 설정
- **envirnoment:** => 컨테이너 내부 환경 변수들
- **ports:** => 로컬 pc와 연결할 포트 (개발 과정에서만 사용)
- **volumes:** => 내 컴퓨터와 컨테이너 내부 폴더 동기화
---
### Api Server 컨테이너 설정
- **build:** => 직접 빌드하기 위한 설정들(context: 현재 폴더에 있는 파일들 빌드 재료로 사용, dockerfile: Dockerfile.backend: 빌드에 사용될 파일)
- **container_name: grad_backend** => 컨테이너 이름 설정
- **ports:** => 로컬 pc와 api 서버를 연결할 포트 설정
- **depends_on: -db** => db실행 후 서버 실행
- **environment:** => 서버 관련 환경 변수들
- **volumes: - .:/app** => 개발용 설정(pc에서 코드 수정 시, 컨테이너에 즉시 반영
---
### 기타 설정
- **volumes: postgres_data:** => 컨테이너 삭제 시, 저장될 데이터 저장 공간생성
---

## 2. Dockerfile.backend
이 파일은 api서버를 위한 setting 자동화 메뉴얼

---
- **FROM ubuntu:22.04** => 베이스 운영체제 설정
- **ENV DEBIAN_FRONTEND=noninteractive** => 설치 시, 모든 질문에 yes설정
- **apt-get update && apt-get install -y \
    gcc g++ cmake git \
    libjsoncpp-dev uuid-dev zlib1g-dev \
    libpq-dev postgresql-client \
    build-essential \
    && rm -rf /var/lib/apt/lists/** => 프로그램 목록 업데이트 -> C++ 컴파일 도구 설치 -> 서버운영에 필요한 라이브러리 설치 -> postgreSQL 연결 라이브러리 설치 -> 설치 관련 불필요한 파일 삭제
- **WORKDIR /tmp \
    RUN git clone https://github.com/drogonframework/drogon.git && \
    cd drogon && \
    git submodule update --init && \
    mkdir build && cd build && \
    cmake .. && make -j$(nproc) && make install && \
    cd /tmp && rm -rf drogon** => tmp/ 이동 -> Drogon 프레임워크 소스코드 내려받기 -> 컨테이너 환경에 맞게 직접 빌드(cmake 파일을 이용함) -> 빠르게 빌드
- **WORKDIR /app** => /app 폴더 이동
- **CMD []** => 컨테이너 유지를 위한 실행 명령어 

## 3. docker 관련 명령어
- **docker-compose up -d --build** => 프로젝트 시작(최초 1회 or 환경 변경 시, 다시)
- **docker-compose down** => 프로젝트 중지
- **docker-compose down -v \
  docker-compose up -d** => DB 초기화 (-v 옵셔으로 데이터 초기화)
- **docker_compose logs -f backend** => 로그 확인








