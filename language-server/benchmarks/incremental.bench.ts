import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'os';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { Config } from '../src/core/config';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { IndexerEnvironment } from '../src/core/indexer-interfaces';
import { benchmark } from './utils';

export async function runIncrementalBenchmarks() {
    console.log("=== Incremental Indexing Benchmarks ===");

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-incr-bench-'));
    
    // Generate 1000 files
    const FILE_COUNT = 1000;
    for (let i = 0; i < FILE_COUNT; i++) {
        fs.writeFileSync(path.join(tempDir, `file_${i}.ts`), `export class Class${i} {}`);
    }

    const env: IndexerEnvironment = {
        getWorkspaceFolders: () => [tempDir],
        findFiles: async () => fs.readdirSync(tempDir).map(f => path.join(tempDir, f)),
        log: () => {},
        asRelativePath: (p) => path.relative(tempDir, p),
        createFileSystemWatcher: () => ({ dispose: () => {} }),
        executeWorkspaceSymbolProvider: async () => [],
        executeDocumentSymbolProvider: async () => []
    };

    const config = new Config({
        getConfiguration: () => ({ get: (key: string) => key === 'searchConcurrency' ? 20 : undefined } as any)
    } as any);

    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const indexer = new WorkspaceIndexer(config, parser, env, extensionPath);
    await indexer.indexWorkspace();

    // Initialize git repo to avoid benchmark failures/noise
    const { execSync } = require('child_process');
    try {
        execSync('git init', { cwd: tempDir, stdio: 'ignore' });
        execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
        execSync('git config user.email "bench@example.com"', { cwd: tempDir, stdio: 'ignore' });
        execSync('git config user.name "Bench"', { cwd: tempDir, stdio: 'ignore' });
        execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    } catch (e) {
        // Ignore git failures, it's just to suppress noise in some environments
    }

    try {
        await benchmark("Update Single File (Incremental)", async () => {
            const filePath = path.join(tempDir, 'file_500.ts');
            fs.writeFileSync(filePath, `export class Class500 { public newMethod${Math.random()}() {} }`);
            await (indexer as any).handleFileChanged(filePath);
        }, 50);
    } finally {
        indexer.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log("\n");
}

if (require.main === module) {
    runIncrementalBenchmarks();
}
