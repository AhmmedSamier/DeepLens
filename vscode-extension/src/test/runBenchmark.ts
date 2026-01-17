import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        // NOTE: We point to 'out/vscode-extension/src/test/benchmark/index' because tests are compiled
        const extensionTestsPath = path.resolve(__dirname, './benchmark/index');

        console.log(`Running benchmarks with:
            Development Path: ${extensionDevelopmentPath}
            Tests Path: ${extensionTestsPath}
        `);

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--no-sandbox', '--disable-gpu', '--headless'],
            extensionTestsEnv: process.env as Record<string, string>
        });
    } catch (err) {
        console.error('Failed to run benchmarks', err);
        process.exit(1);
    }
}

main();
