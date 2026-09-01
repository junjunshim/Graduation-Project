import axios from 'axios';
import * as vscode from 'vscode';

const api = axios.create({
    baseURL: 'http://localhost:8080/api/v1', // Drogon 서버 주소
    timeout: 5000
});

/**
 * [핵심 로직: 요청 인터셉터]
 * 서버로 요청이 나가기 직전에 실행됩니다.
 * 'grad-vscode.getAccessToken' 명령을 호출해 보안 저장소에서 토큰을 가져와 헤더에 넣습니다.
 */
api.interceptors.request.use(async (config) => {
    // extension.ts에 등록된 커맨드를 통해 토큰 호출
    const token = await vscode.commands.executeCommand<string | undefined>('grad-vscode.getAccessToken');
    
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, error => Promise.reject(error));

export default api;