# ⚙️ docker 설치 및 설정 가이드

## 1. docker 설치

### 1) docker desktop 다운로드 : [Docker](https://www.docker.com/products/docker-desktop/)

- 공식 사이트에서 운영체제에 맞는 설치 파일 내려 받기
- 설치 시 주의사항) "Use WSL 2 instead of Hyper-V" 체크 된 상태로 설치 진행(없다면 그냥 진행)

### 2) WSL 2 업데이트
- window 환경에서 docker는 WSL 2에서 돌아가기 때문에 업데이트 진행, 만약 WSL이 설치가 안되어 있다면 설치 진행(cmd에서 관리자 권한으로 진행)
```
wsl --install   # wsl 미설치 시

wsl --update    # wsl 업데이트
wsl --set-default-version 2 #wsl 버전 변경
```
- 이후 컴퓨터 재부팅
- cmd에서 아래 명령이 입력 시, 버전 정보가 출력되면 성공
```
docker --version
docker-compose --version
```

### 3) docker 컨테이너 가동 테스트
- cmd에서 아래 명령어 입력 시, "Hello from Docker!" 출력 시 성공
```
docker run hello-world
```