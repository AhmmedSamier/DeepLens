import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

(async () => {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');
        const extensionTestsPath = path.resolve(__dirname, './benchmark/index');

        console.log(`Running benchmarks with:
            Development Path: ${extensionDevelopmentPath}
            Tests Path: ${extensionTestsPath}
        `);

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--no-sandbox', '--disable-gpu', '--headless', '--js-flags=--expose-gc'],
            extensionTestsEnv: process.env as Record<string, string>,
            timeout: 120_000,
        }).catch((err) => {
            console.error('Failed to run benchmarks', err);
            process.exit(1);
        });
    } catch (err) {
        console.error('Failed to run benchmarks', err);
        process.exit(1);
    }
})();
