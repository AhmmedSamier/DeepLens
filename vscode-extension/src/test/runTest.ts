import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Path to the test workspace
        const workspacePath = path.resolve(__dirname, '../../../../test-workspace');

        // Download VS Code (if needed), unzip it and run the integration test.
        // Use a longer timeout so version resolution and download don't fail on slow networks.
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [workspacePath, '--no-sandbox', '--disable-gpu', '--headless'],
            timeout: 120_000, // 2 minutes for version fetch / download
        });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
}

main();
