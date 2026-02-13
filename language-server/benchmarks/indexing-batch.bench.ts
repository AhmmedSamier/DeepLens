import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { Config } from '../src/core/config';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { IndexerEnvironment } from '../src/core/indexer-interfaces';
import { benchmark } from './utils';

export async function runIndexingBatchBenchmarks() {
    console.log("=== Indexing Batch Update Benchmarks ===");

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-batch-bench-'));
    
    // Generate 2000 files
    const FILE_COUNT = 2000;
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
        getConfiguration: () => ({ get: (key: string) => key === 'searchConcurrency' ? 50 : undefined } as any)
    } as any);

    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const indexer = new WorkspaceIndexer(config, parser, env, extensionPath);
    await indexer.indexWorkspace();

    try {
        const BATCH_SIZE = 500;
        await benchmark(`Batch Update ${BATCH_SIZE} files`, async () => {
            const promises: Promise<any>[] = [];
            for (let i = 0; i < BATCH_SIZE; i++) {
                const filePath = path.join(tempDir, `file_${i}.ts`);
                fs.writeFileSync(filePath, `export class Class${i} { public updated${Math.random()}() {} }`);
                // Simulate the event coming from watcher
                promises.push((indexer as any).handleFileChanged(filePath));
            }
            await Promise.all(promises);
        }, 2);
    } finally {
        indexer.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log("\n");
}

if (require.main === module) {
    runIndexingBatchBenchmarks();
}
