# 📄 docker 관련 파일 설명서

## 컨테이너 전체 구조
우리 시스템은 세개의 컨테이너로 연결된 구조
1. Backend : C++ Drogon 프레임워크 기반 api 서버
2. Database : PostgreSQL 15 기반 데이터베이스
3. Collab : Node.js + Yjs 기반 실시간 문서 서버

## 1. docker-compose.yml
이 파일은 여러 컨테이너를 동시에 실행하고 서로 연결해주는 설계도

---
### DB 컨테이너 설정
- **image: postgres:15** => postgres 15 가져오기
- **container_name: grad_postgres** => 컨테이너 이름 설정
- **restart: always** => 컨테이너가 다운되었을 때, 자동으로 다시 살리는 설정
- **environment:** => 컨테이너 내부 환경 변수들
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

## 2. Dockerfile.backend.base
공통 빌드 환경을 한 번만 만들어 재사용하는 base 이미지

---
- **FROM ubuntu:22.04** => 베이스 운영체제 설정
- **ENV DEBIAN_FRONTEND=noninteractive** => 설치 시 질문이 나오지 않도록 설정
- **apt-get update && apt-get install ...** => C++ 컴파일 도구, Drogon/jwt-cpp 의존 라이브러리, PostgreSQL 클라이언트 설치
- **Drogon build/install** => Drogon 소스를 내려받아 컨테이너 환경에 맞게 빌드하고 시스템에 설치
- **jwt-cpp build/install** => JWT 라이브러리를 빌드하고 시스템에 설치
- **WORKDIR /app** => 최종 작업 디렉토리 설정

## 2-1. Dockerfile.backend
Drogon/jwt-cpp가 설치된 base 이미지를 기반으로 만드는 실제 backend 이미지

---
- **ARG BASE_IMAGE=axisflow-backend-base:1** => 사용할 base 이미지 태그
- **FROM ${BASE_IMAGE}** => 공통 빌드 환경 이미지 사용
- **WORKDIR /app** => 작업 디렉토리 설정
- **CMD exec tail -f /dev/null** => 컨테이너 유지

base 이미지는 아래처럼 한 번만 빌드한다.

```bash
docker build -f Dockerfile.backend.base -t axisflow-backend-base:1 .
docker-compose build backend
```

Drogon, jwt-cpp, 시스템 패키지가 바뀌었을 때만 base 이미지를 다시 빌드하고, 일반 backend 이미지는 `docker-compose build backend`로 갱신한다.

## 3. docker 관련 명령어
- **docker-compose up -d --build** => 프로젝트 시작(최초 1회 or 환경 변경 시, 다시)
- **docker-compose down** => 프로젝트 중지
- **docker-compose down -v && docker-compose up -d --build** => DB 초기화 (-v 옵션으로 데이터 초기화)
- **docker-compose logs -f backend** => 로그 확인

## 4. Docker 빌드 최적화

### 4.1 `.dockerignore`

`.dockerignore`는 `docker build` 시 Docker 데몬으로 전송할 파일을 제한한다. 저장소 전체를 빌드 컨텍스트로 보내면 이미지 빌드에 필요 없는 파일까지 매번 전송되므로 빌드가 느려진다.

현재 제외하는 주요 항목:

- `.git`, `.github`, `.vscode`
- `grad_client`, `grad_vscode`, `docs`, `assets`
- `grad_server/build`, `grad_server/test`, `grad_server/repository`
- `grad_collab/node_modules`, `grad_collab/dist`
- `.env`, 로그 파일

`grad_collab`의 `package.json`, `package-lock.json`, `tsconfig.json`, `src`는 collab 이미지 빌드에 필요하므로 제외하지 않는다.

주의: `.dockerignore`는 빌드 컨텍스트에만 영향을 준다. `.:/app` 런타임 bind mount, Compose의 `.env` 변수 치환, `env_file`에는 영향을 주지 않는다. 따라서 `.env`를 제외해도 런타임 환경변수는 정상 주입된다.

### 4.2 BuildKit / buildx

- **BuildKit**: Docker의 최신 이미지 빌드 엔진
- **buildx**: BuildKit을 사용할 수 있게 해주는 Docker CLI 플러그인
- **docker-buildx-plugin**: `docker buildx` 명령과 Compose의 BuildKit 연동을 제공하는 패키지

BuildKit을 사용하면 레이어 캐시 재사용, 병렬 빌드, `RUN --mount=type=cache` 같은 캐시 마운트를 사용할 수 있다. 단, 첫 빌드의 C++ 컴파일 자체가 빨라지는 것은 아니며 기존 legacy 빌더 캐시는 재사용되지 않는다.

설치 및 확인:

```bash
docker buildx version

# 없을 때 (Docker 공식 apt 저장소 기준)
sudo apt update
sudo apt install -y docker-buildx-plugin
```

현재 서버의 `docker-compose version`이 `v5.4.0`이면 Compose v1이 아니라 최신 Compose다. `docker compose`가 `unknown command`로 나오는 것은 Docker CLI 플러그인만 설치되지 않은 것이며, 기존 `docker-compose` 명령은 계속 사용할 수 있다.

## 5. Compose v1과 v2

| 항목 | Compose v1 | Compose v2 이상 |
|---|---|---|
| 구현 | Python | Go |
| 실행 명령 | `docker-compose` | `docker compose` |
| 형태 | 별도 실행 파일 | Docker CLI 플러그인 |
| Compose 파일 | `version` 필드 사용 | Compose Specification, `version` 불필요 |
| 빌드 | legacy 빌더 | BuildKit/buildx |
| 유지보수 | 2023년 EOL | 현재 권장 |

현재 프로젝트에서는 `docker-compose` 명령을 그대로 사용해도 된다. `docker compose`도 함께 사용하려면 Docker 공식 저장소 기준으로 플러그인을 설치한다.

```bash
sudo apt update
sudo apt install -y docker-compose-plugin
docker compose version
```

구형 Compose v1에서 BuildKit을 사용할 때만 다음 환경변수를 사용한다.

```bash
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker-compose build backend
```

## 6. 빌드 및 실행 명령

| 목적 | 명령 |
|---|---|
| 전체 서비스 빌드 후 시작 | `docker-compose up -d --build` |
| 백엔드만 빌드 후 시작 | `docker-compose up -d --build backend` |
| 이미지 빌드 없이 시작 | `docker-compose up -d --no-build` |
| 백엔드 이미지만 빌드 | `docker-compose build backend` |
| 캐시를 무시하고 빌드 | `docker-compose build --no-cache backend` |
| 로그 확인 | `docker-compose logs -f backend` |

`--build`는 무조건 처음부터 다시 컴파일하는 옵션이 아니다. 이미지 빌드 단계를 실행하되 Docker 캐시를 사용한다. 캐시를 의심할 때만 `--no-cache`를 사용한다.

일반적인 소스 코드 변경은 이미지 빌드가 필요 없다. 소스는 `.:/app`으로 bind mount되므로 컨테이너 안에서 직접 컴파일한다.

```bash
docker-compose up -d --no-build
docker exec -it grad_backend bash -c \
  'cd /app/grad_server/build && cmake .. && make -j$(nproc)'
```

`up -d --build`로 backend 컨테이너가 재생성되면 컨테이너 안에서 실행 중이던 `grad_server` 프로세스도 종료된다. 이때는 다시 실행한다.

```bash
docker exec -d grad_backend bash -c \
  'cd /app/grad_server/build && nohup ./grad_server >> server.log 2>&1 < /dev/null'
```

## 7. 컨테이너 alias

컨테이너 안의 alias는 컨테이너 쓰기 레이어에만 저장되므로 `docker-compose down` 후 컨테이너를 다시 만들면 사라진다. `docker restart`에서는 유지된다.

가장 간단한 방법은 EC2 호스트의 `~/.bashrc` 또는 `~/.bash_aliases`에 `docker exec`를 감싼 alias/함수를 두는 것이다.

```bash
alias gbash='docker exec -it grad_backend bash'
alias glog='docker exec grad_backend tail -F /app/grad_server/build/server.log'

gbuild() {
    docker exec -it grad_backend bash -c \
      'cd /app/grad_server/build && cmake .. && make -j$(nproc)'
}
```

컨테이너 내부에서 alias를 유지하려면 저장소의 `.bashrc` 파일을 bind mount한다.

```yaml
volumes:
  - .:/app
  - ./deploy/container/grad_backend.bashrc:/root/.bashrc:ro
```

이 방식은 alias 파일이 저장소에 있으므로 컨테이너를 재생성해도 유지된다. 단, `docker exec grad_backend ls` 같은 비대화형 명령에는 alias가 적용되지 않으므로 자동화에는 `/usr/local/bin` 스크립트를 사용한다.








