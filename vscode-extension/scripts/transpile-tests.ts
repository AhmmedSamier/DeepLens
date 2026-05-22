import * as esbuild from 'esbuild';
import { glob } from 'glob';
import { resolve } from 'node:path';

const rootDir = resolve(__dirname, '..');

async function main() {
    const testFiles = await glob('src/test/**/*.ts', { cwd: rootDir });
    const sourceFiles = await glob('src/**/*.ts', { cwd: rootDir, ignore: 'src/test/**/*' });
    const lsCoreFiles = await glob('../language-server/src/core/**/*.ts', {
        cwd: rootDir,
        ignore: '../language-server/src/core/**/*.test.ts',
    });

    await esbuild.build({
        entryPoints: [...testFiles, ...sourceFiles, ...lsCoreFiles],
        outdir: resolve(rootDir, 'out'),
        outbase: resolve(rootDir, '..'),
        format: 'cjs',
        platform: 'node',
        target: 'ES2021',
        bundle: false,
        logLevel: 'error',
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
