import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

import { apiRequest } from '../api';
import { layoutGitGraph } from './gitGraph';
import { isGraphCommit, type GraphCommit } from './graphProvider';
import { getCurrentBranch, getRepositoryDisplayName, getSession, onDidChangeSession } from './repoSession';
import { NO_SESSION_MESSAGE } from './repoTreeProvider';
import { onDidChangeCommitList } from './repoStatus';

/**
 * [TASK_11 §15.16] 저장소 전체 그래프 — 웹뷰 패널.
 *
 * 사이드바 Graph 뷰(`graphProvider.ts`)는 지금 브랜치의 커밋을 **일렬 목록**으로 보여 준다 —
 * 접기/펼치기·컨텍스트 메뉴·내장 diff 가 모두 붙어 있어야 하므로 TreeView 여야 한다(§15.1).
 * 반대로 "저장소 전체가 어떻게 갈라지고 합쳐졌나" 는 한 화면에 곡선으로 그려야 읽히는데,
 * TreeView 는 셀 단위로 그릴 수 없다. 그래서 그 부분만 웹뷰로 떼어 냈다.
 *
 * 데이터는 사이드바와 같은 엔드포인트(`GET /api/github/repos/commits`)이고, `all=true` 로
 * 모든 브랜치·원격 추적 참조·태그를 한 번에 받는다(§3.2). 레인 배치는 확장이 계산해
 * (`gitGraph.ts` 순수 함수) 결과만 웹뷰에 넘긴다 — 웹뷰는 그리기만 한다.
 *
 * 보안: 웹뷰에는 어떤 토큰도 넘기지 않는다. 화면에 필요한 값(제목·작성자·시각·ref)만 보내고,
 * 그 값은 전부 `textContent` 로 넣어 HTML 로 해석되지 않게 한다. CSP 는 nonce 로 좁힌다.
 */

const PANEL_VIEW_TYPE = 'axis-share.repoGraph';

/** 서버 상한(200)이 곧 한 번에 그리는 최대치다(§3.2). */
const COMMIT_LIMIT = 200;

let panel: vscode.WebviewPanel | undefined;

/**
 * 웹뷰 스크립트가 준비됐는가.
 *
 * `webview.html` 을 넣은 직후의 `postMessage` 는 **버려진다** — 웹뷰의 스크립트가 아직 안 떴기 때문이다.
 * 그래서 웹뷰가 스스로 `ready` 를 보낼 때까지는 아무것도 보내지 않는다(먼저 그리면 빈 화면이 남는다).
 */
let webviewReady = false;

/** 늦게 도착한 응답이 최신 화면을 덮지 않게 하는 순번. */
let requestSeq = 0;

/**
 * 커밋·push·세션·브랜치 변화를 패널 갱신에 잇는다(§15.10). 패널이 닫혀 있으면 아무 일도 하지 않으므로
 * activate 에서 한 번만 등록한다.
 */
export function startRepositoryGraph(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        onDidChangeSession(() => void refreshPanel()),
        onDidChangeCommitList(() => void refreshPanel())
    );
}

/** Graph 뷰 타이틀의 `$(git-merge)` 가 부른다. 이미 열려 있으면 그 탭을 앞으로 가져온다. */
export function openRepositoryGraph(): void {
    const existing = panel;
    if (existing) {
        existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active);
        void refreshPanel();
        return;
    }

    const created = vscode.window.createWebviewPanel(
        PANEL_VIEW_TYPE,
        'Axis Share: 저장소 전체 그래프',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            // 탭을 오갈 때 다시 그리지 않게 화면을 유지한다. 다시 받는 것은 위 이벤트가 시킨다.
            retainContextWhenHidden: true,
            // 내장 찾기(Ctrl+F)를 쓸 수 있게 한다 — 긴 이력에서 커밋을 찾는 가장 빠른 길이다.
            enableFindWidget: true
        }
    );

    panel = created;
    webviewReady = false;
    created.webview.html = shellHtml(created.webview);

    created.webview.onDidReceiveMessage((message: unknown) => {
        if (!isRecord(message)) {
            return;
        }

        // 웹뷰가 스크립트를 띄우고 보내는 첫 신호다. 그 전에 보낸 메시지는 전달되지 않으므로 여기서 처음 그린다.
        if (message.type === 'ready') {
            webviewReady = true;
            void refreshPanel();
            return;
        }

        if (message.type === 'refresh') {
            void refreshPanel();
        }
    });

    created.onDidChangeViewState(() => {
        if (panel?.visible) {
            void refreshPanel();
        }
    });

    created.onDidDispose(() => {
        panel = undefined;
        webviewReady = false;
    });

    void refreshPanel();
}

/**
 * 커밋 목록을 받아 레인을 계산하고 웹뷰에 넘긴다.
 *
 * 실패는 화면 안에 적는다(토스트를 띄우지 않는다) — 자동 갱신이 잦아 토스트가 쌓이기 때문이다.
 */
async function refreshPanel(): Promise<void> {
    const target = panel;
    if (!target || !target.visible || !webviewReady) {
        return;
    }

    requestSeq += 1;
    const seq = requestSeq;

    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        target.title = 'Axis Share: 저장소 전체 그래프';
        post(target, { type: 'note', message: NO_SESSION_MESSAGE });
        return;
    }

    post(target, { type: 'loading' });

    try {
        const rows = await apiRequest<GraphCommit[]>(
            `/github/repos/commits?repo_id=${session.repoId}&all=true&limit=${COMMIT_LIMIT}`
        );

        // 그 사이 새 요청이 나갔거나 패널이 닫혔으면 이 결과는 버린다.
        if (seq !== requestSeq || panel !== target) {
            return;
        }

        const commits = Array.isArray(rows) ? rows.filter(isGraphCommit) : [];
        const layout = layoutGitGraph(commits);
        const repoName = getRepositoryDisplayName(session) ?? `저장소 ${session.repoId}`;
        target.title = `전체 그래프 — ${repoName}`;

        post(target, {
            type: 'render',
            payload: {
                repoName,
                branch,
                nodes: layout.nodes,
                edges: layout.edges,
                laneCount: layout.laneCount,
                laneSpans: layout.laneSpans,
                converged: layout.converged,
                // 상한에 닿았으면 더 있을 수 있다고 알린다(서버가 200 에서 자른다).
                truncated: commits.length >= COMMIT_LIMIT
            }
        });
    } catch (error) {
        if (seq !== requestSeq || panel !== target) {
            return;
        }

        post(target, { type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
}

function post(target: vscode.WebviewPanel, message: unknown): void {
    void target.webview.postMessage(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 웹뷰 껍데기. 한 번만 만들고 갱신은 `postMessage` 로 한다 — 다시 그려도 스크롤 위치가 튀지 않는다.
 *
 * CSP 는 `nonce` 로 좁히고 바깥 리소스는 아예 쓰지 않는다(색은 VS Code 테마 변수로만).
 * 안쪽 스크립트는 문자열 결합으로 쓴다 — 이 문자열 자체가 템플릿 리터럴이라 백틱과 `${}` 를
 * 그대로 쓸 수 없기 때문이다.
 */
function shellHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [
        "default-src 'none'",
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `img-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>저장소 전체 그래프</title>
<style>
body {
    margin: 0;
    padding: 0 0 24px 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
}
#head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
}
#head .grow {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#head .name { font-weight: 600; }
#head .desc { color: var(--vscode-descriptionForeground); margin-left: 6px; }
button {
    flex: 0 0 auto;
    font-family: inherit;
    font-size: inherit;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
}
button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.2)); }
#status { padding: 12px; color: var(--vscode-descriptionForeground); }
#status.error { color: var(--vscode-errorForeground); }
#list { list-style: none; margin: 0; padding: 0; }
.row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 12px;
}
.row:hover { background: var(--vscode-list-hoverBackground); }
.graph { flex: 0 0 auto; }
.body { flex: 1 1 auto; min-width: 0; }
.titleLine { display: flex; align-items: center; gap: 6px; min-width: 0; }
.subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ref {
    flex: 0 0 auto;
    padding: 0 5px;
    border-radius: 3px;
    font-size: 11px;
    line-height: 16px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
}
.ref.current {
    background: transparent;
    color: var(--vscode-charts-blue);
    box-shadow: inset 0 0 0 1px var(--vscode-charts-blue);
}
.overflow { flex: 0 0 auto; font-size: 11px; color: var(--vscode-descriptionForeground); }
.meta {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.meta .sha { font-family: var(--vscode-editor-font-family); }
.line { stroke-width: 1.6; stroke-linecap: round; fill: none; }
.node { stroke: var(--vscode-editor-background); stroke-width: 1; }
</style>
</head>
<body>
<div id="head">
    <div class="grow"><span class="name" id="repo">저장소 전체 그래프</span><span class="desc" id="desc"></span></div>
    <button id="refresh" type="button" title="다시 받기">새로 고침</button>
</div>
<div id="status">불러오는 중입니다…</div>
<ul id="list"></ul>
<script nonce="${nonce}">
(function () {
    const api = acquireVsCodeApi();
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ROW_HEIGHT = 40;
    const LANE_WIDTH = 14;
    const NODE_RADIUS = 3.5;
    const MAX_REF_CHIPS = 4;
    const LANE_COLORS = [
        'var(--vscode-charts-blue)',
        'var(--vscode-charts-purple)',
        'var(--vscode-charts-orange)',
        'var(--vscode-charts-green)',
        'var(--vscode-charts-red)'
    ];

    const repoLabel = document.getElementById('repo');
    const descLabel = document.getElementById('desc');
    const statusBox = document.getElementById('status');
    const listBox = document.getElementById('list');

    document.getElementById('refresh').addEventListener('click', function () {
        statusBox.className = '';
        statusBox.textContent = '다시 받는 중입니다…';
        api.postMessage({ type: 'refresh' });
    });

    function laneColor(lane) {
        return LANE_COLORS[lane % LANE_COLORS.length];
    }

    function laneX(lane) {
        return lane * LANE_WIDTH + LANE_WIDTH / 2;
    }

    function svg(name, attrs) {
        const el = document.createElementNS(SVG_NS, name);
        for (const key in attrs) {
            el.setAttribute(key, String(attrs[key]));
        }
        return el;
    }

    function span(className, text) {
        const el = document.createElement('span');
        if (className) {
            el.className = className;
        }
        el.textContent = text;
        return el;
    }

    function formatWhen(value) {
        if (!value) {
            return '';
        }
        const parsed = new Date(value);
        return isNaN(parsed.getTime())
            ? value
            : parsed.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    }

    function isCurrentRef(ref, branch) {
        return ref === branch || ref === 'HEAD -> ' + branch;
    }

    // 한 행의 그래프. 앱의 SVG 렌더와 같은 규칙이다(§15.16) — 레인 선, 머지 곡선, 합쳐지는 짧은 선, 노드.
    function buildGraph(node, row, payload) {
        const incoming = new Set(row > 0 ? payload.laneSpans[row - 1] : []);
        const outgoing = new Set(payload.laneSpans[row]);
        const lanes = Array.from(new Set(Array.from(incoming).concat(Array.from(outgoing)))).sort(function (a, b) {
            return a - b;
        });
        const merges = payload.edges.filter(function (edge) {
            return edge.from.row === row && edge.from.lane !== edge.to.lane;
        });

        const width = Math.max(payload.laneCount, 1) * LANE_WIDTH;
        const half = ROW_HEIGHT / 2;
        const graph = svg('svg', {
            class: 'graph',
            width: width,
            height: ROW_HEIGHT,
            viewBox: '0 0 ' + width + ' ' + ROW_HEIGHT,
            'aria-hidden': 'true'
        });

        lanes.forEach(function (lane) {
            // 이 행에서 처음 생긴 레인은 커밋 자신의 자리에서만 위로 올라간다.
            // 머지로 새로 생긴 레인은 아래 곡선이 대신 그린다.
            const start = incoming.has(lane) ? 0 : (lane === node.lane ? half : null);
            const end = outgoing.has(lane) ? ROW_HEIGHT : half;
            if (start === null || start === end) {
                return;
            }

            graph.appendChild(svg('line', {
                class: 'line',
                x1: laneX(lane),
                y1: start,
                x2: laneX(lane),
                y2: end,
                style: 'stroke: ' + laneColor(lane)
            }));
        });

        merges.forEach(function (edge) {
            graph.appendChild(svg('path', {
                class: 'line',
                d: 'M ' + laneX(edge.from.lane) + ' ' + half +
                    ' C ' + laneX(edge.from.lane) + ' ' + (ROW_HEIGHT * 0.75) + ', ' +
                    laneX(edge.to.lane) + ' ' + (ROW_HEIGHT * 0.75) + ', ' +
                    laneX(edge.to.lane) + ' ' + ROW_HEIGHT,
                style: 'stroke: ' + laneColor(edge.to.lane)
            }));
        });

        payload.converged[row].forEach(function (lane) {
            graph.appendChild(svg('line', {
                class: 'line',
                x1: laneX(lane),
                y1: half,
                x2: laneX(node.lane),
                y2: half,
                style: 'stroke: ' + laneColor(lane)
            }));
        });

        graph.appendChild(svg('circle', {
            class: 'node',
            cx: laneX(node.lane),
            cy: half,
            r: NODE_RADIUS,
            style: 'fill: ' + laneColor(node.lane)
        }));

        return graph;
    }

    function buildRow(node, row, payload) {
        const commit = node.commit || {};
        const refs = Array.isArray(commit.refs) ? commit.refs : [];

        const item = document.createElement('li');
        item.className = 'row';
        item.appendChild(buildGraph(node, row, payload));

        const titleLine = document.createElement('div');
        titleLine.className = 'titleLine';

        refs.slice(0, MAX_REF_CHIPS).forEach(function (ref) {
            const chip = span('ref' + (isCurrentRef(ref, payload.branch) ? ' current' : ''), ref);
            chip.title = ref;
            titleLine.appendChild(chip);
        });

        if (refs.length > MAX_REF_CHIPS) {
            const extra = refs.slice(MAX_REF_CHIPS).join(', ');
            const more = span('overflow', '+' + (refs.length - MAX_REF_CHIPS));
            more.title = extra;
            titleLine.appendChild(more);
        }

        const subject = commit.subject ? commit.subject.trim() : '';
        const subjectNode = span('subject', subject.length > 0 ? subject : '(제목 없음)');
        subjectNode.title = subject;
        titleLine.appendChild(subjectNode);

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.appendChild(span('sha', (commit.sha || '').slice(0, 7)));

        const author = (commit.author_name || '').trim() || (commit.author_email || '').trim();
        if (author) {
            meta.appendChild(span('', ' · ' + author));
        }

        const when = formatWhen(commit.authored_at);
        if (when) {
            meta.appendChild(span('', ' · ' + when));
        }

        if (Array.isArray(commit.parents) && commit.parents.length > 1) {
            meta.appendChild(span('', ' · 머지'));
        }

        const body = document.createElement('div');
        body.className = 'body';
        body.appendChild(titleLine);
        body.appendChild(meta);
        item.appendChild(body);

        return item;
    }

    function render(payload) {
        repoLabel.textContent = payload.repoName;
        descLabel.textContent = ' · ' + payload.branch + ' · ' + (payload.truncated
            ? '최신 ' + payload.nodes.length + '개만 표시'
            : '커밋 ' + payload.nodes.length + '개');

        const scroller = document.scrollingElement || document.documentElement;
        const keepScroll = scroller.scrollTop;

        listBox.textContent = '';
        payload.nodes.forEach(function (node, row) {
            listBox.appendChild(buildRow(node, row, payload));
        });

        if (payload.nodes.length === 0) {
            statusBox.className = '';
            statusBox.textContent = '표시할 커밋이 없습니다.';
        } else {
            statusBox.className = '';
            statusBox.textContent = '';
        }

        scroller.scrollTop = keepScroll;
    }

    window.addEventListener('message', function (event) {
        const message = event.data;
        if (!message || typeof message !== 'object') {
            return;
        }

        if (message.type === 'loading') {
            statusBox.className = '';
            statusBox.textContent = '불러오는 중입니다…';
            return;
        }

        if (message.type === 'note') {
            listBox.textContent = '';
            statusBox.className = '';
            statusBox.textContent = message.message;
            return;
        }

        if (message.type === 'error') {
            listBox.textContent = '';
            statusBox.className = 'error';
            statusBox.textContent = '불러오지 못했습니다: ' + message.message;
            return;
        }

        if (message.type === 'render') {
            render(message.payload);
        }
    });

    // 스크립트가 떴다는 신호. 호스트는 이 신호를 받고 처음 그린다(그 전 메시지는 전달되지 않는다).
    api.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}