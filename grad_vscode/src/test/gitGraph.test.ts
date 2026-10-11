import * as assert from 'assert';

import { layoutGitGraph } from '../repo/gitGraph';

/**
 * [TASK_11 §15.16] 레인 배치 순수 함수 검증.
 *
 * 앱(`grad_client/tests/gitGraph.test.ts`)과 같은 케이스다 — 두 화면이 같은 이력을 같은 모양으로
 * 그려야 하므로, 규칙이 어긋나면 여기서 먼저 걸린다.
 */
suite('Axis Share 커밋 그래프 레인 배치', () => {
    const commit = (sha: string, parents: string[]) => ({ sha, parents });

    test('일자 이력은 한 레인에 붙고, 마지막 행에서 비워진다', () => {
        const layout = layoutGitGraph([commit('c', ['b']), commit('b', ['a']), commit('a', [])]);

        assert.deepStrictEqual(layout.nodes.map((node) => node.lane), [0, 0, 0]);
        assert.strictEqual(layout.laneCount, 1);
        assert.deepStrictEqual(layout.laneSpans, [[0], [0], []]);
        assert.deepStrictEqual(layout.converged, [[], [], []]);
        assert.deepStrictEqual(layout.edges, [
            { from: { lane: 0, row: 0 }, to: { lane: 0, row: 1 } },
            { from: { lane: 0, row: 1 }, to: { lane: 0, row: 2 } }
        ]);
    });

    test('머지의 둘째 부모는 다른 레인으로 보내고, 다시 만나면 그 레인을 합친다', () => {
        // m ─┬─ a1 ── base
        //    └─ b1 ──┘
        const layout = layoutGitGraph([
            commit('m', ['a1', 'b1']),
            commit('a1', ['base']),
            commit('b1', ['base']),
            commit('base', [])
        ]);

        assert.deepStrictEqual(layout.nodes.map((node) => node.lane), [0, 0, 1, 0]);
        assert.strictEqual(layout.laneCount, 2);
        assert.deepStrictEqual(layout.laneSpans[0], [0, 1]);
        // base 는 두 레인이 함께 기다리던 커밋이라 1번 레인이 여기서 합쳐지고 아래로는 줄이 남지 않는다.
        assert.deepStrictEqual(layout.converged[3], [1]);
        assert.deepStrictEqual(layout.laneSpans[3], []);
        assert.deepStrictEqual(layout.edges, [
            { from: { lane: 0, row: 0 }, to: { lane: 0, row: 1 } },
            { from: { lane: 0, row: 0 }, to: { lane: 1, row: 2 } },
            { from: { lane: 0, row: 1 }, to: { lane: 0, row: 3 } },
            { from: { lane: 1, row: 2 }, to: { lane: 0, row: 3 } }
        ]);
    });

    test('만나지 않는 줄기는 새 레인에 놓는다', () => {
        const layout = layoutGitGraph([
            commit('main2', ['main1']),
            commit('side1', ['side0']),
            commit('main1', []),
            commit('side0', [])
        ]);

        assert.deepStrictEqual(layout.nodes.map((node) => node.lane), [0, 1, 0, 1]);
        assert.strictEqual(layout.laneCount, 2);
        assert.deepStrictEqual(layout.laneSpans[1], [0, 1]);
        assert.deepStrictEqual(layout.laneSpans[2], [1]);
        assert.deepStrictEqual(layout.laneSpans[3], []);
        assert.deepStrictEqual(layout.edges, [
            { from: { lane: 0, row: 0 }, to: { lane: 0, row: 2 } },
            { from: { lane: 1, row: 1 }, to: { lane: 1, row: 3 } }
        ]);
    });

    test('limit 밖으로 잘린 부모는 선을 그리지 않는다', () => {
        const layout = layoutGitGraph([commit('c', ['b'])]);

        assert.deepStrictEqual(layout.edges, []);
        // 아래에 올 선은 있지만 그릴 상대가 없으므로 레인은 열린 채 남는다.
        assert.deepStrictEqual(layout.laneSpans[0], [0]);
    });

    test('parents 가 없는 커밋(루트·누락)도 죽지 않는다', () => {
        const layout = layoutGitGraph([{ sha: 'only' }, { sha: 'orphan', parents: undefined }]);

        assert.deepStrictEqual(layout.nodes.map((node) => node.lane), [0, 0]);
        assert.deepStrictEqual(layout.laneSpans, [[], []]);
    });

    test('빈 목록은 레인 없이 돌아온다', () => {
        const layout = layoutGitGraph([]);

        assert.deepStrictEqual(layout.nodes, []);
        assert.deepStrictEqual(layout.edges, []);
        assert.strictEqual(layout.laneCount, 0);
    });
});