import axios from 'axios';
import * as vscode from 'vscode';

const DEFAULT_SERVER_URL = 'https://axisflow.team/api';

/**
 * 설정(grad-vscode.serverUrl)에서 서버 API 공통 URL을 읽습니다.
 * 요청마다 읽으므로 설정을 바꾸면 확장을 다시 로드하지 않아도 다음 요청부터 반영됩니다.
 */
function getServerUrl(): string {
    const configured = vscode.workspace
        .getConfiguration('grad-vscode')
        .get<string>('serverUrl');

    const value = configured?.trim();

    if (!value) {
        return DEFAULT_SERVER_URL;
    }

    // 마지막 슬래시를 제거해 경로 결합 시 이중 슬래시를 방지합니다.
    return value.replace(/\/+$/, '');
}

const api = axios.create({
    // baseURL 은 요청 인터셉터에서 설정합니다. (설정 변경 즉시 반영)
    timeout: 10_000
});

/**
 * [핵심 로직: 요청 인터셉터]
 * 서버로 요청이 나가기 직전에 실행됩니다.
 * 'grad-vscode.getAccessToken' 명령을 호출해 보안 저장소에서 토큰을 가져와 헤더에 넣습니다.
 */
api.interceptors.request.use(async (config) => {
    config.baseURL = getServerUrl();

    // extension.ts에 등록된 커맨드를 통해 토큰 호출
    const token = await vscode.commands.executeCommand<string | undefined>('grad-vscode.getAccessToken');

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, error => Promise.reject(error));

export default api;