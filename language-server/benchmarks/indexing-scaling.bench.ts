import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { Config } from '../src/core/config';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { IndexerEnvironment } from '../src/core/indexer-interfaces';
import { benchmark } from './utils';

export async function runIndexingScalingBenchmarks() {
    console.log("=== Indexing Concurrency Scaling Benchmarks ===");

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-scaling-bench-'));
    
    // Generate 2000 files for a decent load
    const FILE_COUNT = 2000;
    for (let i = 0; i < FILE_COUNT; i++) {
        fs.writeFileSync(path.join(tempDir, `file_${i}.ts`), `export class Class${i} { method() {} }`);
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

    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const concurrencies = [10, 20, 50, 100];

    for (const concurrency of concurrencies) {
        const config = new Config({
            getConfiguration: () => ({ 
                get: (key: string) => key === 'searchConcurrency' ? concurrency : undefined 
            } as any)
        } as any);

        const indexer = new WorkspaceIndexer(config, parser, env, extensionPath);
        
        try {
            await benchmark(`Index ${FILE_COUNT} files (Concurrency: ${concurrency})`, async () => {
                await indexer.indexWorkspace();
            }, 2);
        } finally {
            indexer.dispose();
        }
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log("\n");
}

if (require.main === module) {
    runIndexingScalingBenchmarks();
}
