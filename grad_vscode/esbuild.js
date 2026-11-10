const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`[ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    const extensionCtx = await esbuild.context({
        entryPoints: [
            'src/extension.ts'
        ],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    });

    // AI CLI 가 익스텐션 호스트 밖에서 실행하는 stdio MCP 서버. `vscode` 를 쓰지 않는다.
    const mcpCtx = await esbuild.context({
        entryPoints: [
            'src/mcp/axisShareMcp.ts'
        ],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/mcp/axis-share-mcp.js',
        logLevel: 'silent',
        plugins: [
            esbuildProblemMatcherPlugin,
        ],
    });

    if (watch) {
        await Promise.all([extensionCtx.watch(), mcpCtx.watch()]);
    } else {
        await Promise.all([extensionCtx.rebuild(), mcpCtx.rebuild()]);
        await Promise.all([extensionCtx.dispose(), mcpCtx.dispose()]);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
