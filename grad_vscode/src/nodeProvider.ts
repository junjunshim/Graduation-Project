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
                String(item.parent_id) === String(element.nodeId) &&
                (item.type === 'NODE' || item.type === 'WORK_ITEM')
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
        const hasChildren = this.allNodes.some(n => 
            String(n.parent_id) === String(item.id) &&
            (n.type === 'NODE' || n.type === 'WORK_ITEM')
        );
        
        const treeItem = new NodeItem(
            item.title || "이름 없음", 
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            String(item.id),
        );

        // 3. 타입에 따른 분기 처리
        if (item.type === 'NODE') {
            
        }

        if (item.type === 'WORK_ITEM') {
            treeItem.iconPath = new vscode.ThemeIcon('checklist');
            treeItem.contextValue = 'workitem';

            // [업무 클릭 시] 부모 노드의 ID를 인자로 넘깁니다.
            (treeItem as any).command = {
                command: 'grad-vscode.showMembers',
                title: '멤버 보기',
                // 업무의 경우 '부모의 이름'과 '부모의 ID'를 넘겨서 멤버를 찾게 합니다.
                // (참고: item.parent_id가 부모 노드의 ID입니다)
                arguments: [item.title, String(item.parent_id), true] // 세 번째 인자는 업무 여부 플래그
            };
        } 
        else {
            treeItem.iconPath = new vscode.ThemeIcon('organization');
            treeItem.contextValue = 'node';

            // [노드 클릭 시] 자기 자신의 ID를 넘깁니다.
            (treeItem as any).command = {
                command: 'grad-vscode.showMembers',
                title: '멤버 보기',
                arguments: [item.title, String(item.id), false]
            };
        }


        return treeItem;
    }

    // 특정 노드에 속한 멤버(ROLE)들만 반환하는 도우미 함수
    public getMembersForNode(nodeId: string): any[] {
        return this.allNodes.filter(item => 
            item.type === 'ROLE' && String(item.parent_id) === String(nodeId)
        );
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