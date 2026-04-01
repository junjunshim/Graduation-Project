import * as vscode from 'vscode';
import api from './api';

export class GradNodeProvider implements vscode.TreeDataProvider<NodeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NodeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private allNodes: any[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NodeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: NodeItem): Promise<NodeItem[]> {
        const token = await vscode.commands.executeCommand<string | undefined>('grad-vscode.getAccessToken');
        
        if (!token) {
            return [new NodeItem("로그인이 필요합니다", vscode.TreeItemCollapsibleState.None, "0", {
                command: 'grad-vscode.login',
                title: '로그인'
            })];
        }

        try {
            // 1. 최상위 호출 (Root)
            if (!element) {
                console.log('--- API 호출 시작 (/context/init) ---');
                const response = await api.get('/context/init');
                
                // 중요: 보내주신 JSON은 response.data.data에 배열이 들어있습니다.
                this.allNodes = response.data.data || [];
                
                console.log('받은 전체 데이터 개수:', this.allNodes.length);
                
                // 최상위 노드 필터링: parent_id가 없거나 null/undefined인 NODE
                const roots = this.allNodes.filter(item => 
                    item.type === 'NODE' && (item.parent_id === null || item.parent_id === undefined)
                );

                console.log('최상위(Root) 노드 개수:', roots.length);
                if (roots.length === 0) {
                    return [new NodeItem("표시할 루트 노드가 없습니다.", vscode.TreeItemCollapsibleState.None, "0")];
                }

                return roots.map(item => this.mapToNodeItem(item));
            }

            // 2. 하위 노드 호출 (자식 찾기)
            console.log(`자식 노드 찾는 중... 부모 ID: ${element.nodeId}`);
            const children = this.allNodes.filter(item => 
                String(item.parent_id) === String(element.nodeId)
                // 여기서 item.type === 'NODE' 조건을 빼면 WORK_ITEM도 같이 나옵니다!
            );
            console.log(`${element.label}의 자식 개수:`, children.length);

            // [핵심 수정]: WORK_ITEM이 먼저 오고, NODE가 나중에 오도록 정렬
            children.sort((a, b) => {
                if (a.type === 'WORK_ITEM' && b.type === 'NODE') return -1; // a(업무)를 앞으로
                if (a.type === 'NODE' && b.type === 'WORK_ITEM') return 1;  // b(업무)를 앞으로
                return 0; // 같은 타입끼리는 순서 유지
            });
            return children.map(item => this.mapToNodeItem(item));

        } catch (err: any) {
            console.error('에러 발생:', err.message);
            return [new NodeItem("서버 연결 실패", vscode.TreeItemCollapsibleState.None, "0")];
        }
    }

    private mapToNodeItem(item: any): NodeItem {
        const hasChildren = this.allNodes.some(n => String(n.parent_id) === String(item.id));
        
        // 아이템 타입에 따라 아이콘을 다르게 주면 훨씬 보기 좋습니다.
        const treeItem = new NodeItem(
            item.title || "이름 없음", 
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            String(item.id)
        );

        // WORK_ITEM일 경우 아이콘 변경 (VS Code 내장 아이콘 사용)
        if (item.type === 'WORK_ITEM') {
            treeItem.iconPath = new vscode.ThemeIcon('checklist'); // 체크리스트 아이콘
            treeItem.contextValue = 'workitem';
        } else {
            treeItem.iconPath = new vscode.ThemeIcon('organization'); // 부서는 빌딩 아이콘
        }

        return treeItem;
    }
}

export class NodeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly nodeId: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `ID: ${this.nodeId}`;
        this.contextValue = 'node';
    }
}