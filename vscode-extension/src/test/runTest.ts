import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

(async () => {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const workspacePath = path.resolve(__dirname, '../../../../test-workspace');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [workspacePath, '--no-sandbox', '--disable-gpu', '--headless'],
            timeout: 120_000,
        }).catch((err) => {
            console.error('Failed to run tests', err);
            process.exit(1);
        });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
})();
