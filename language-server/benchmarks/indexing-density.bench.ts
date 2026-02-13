import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { Config } from '../src/core/config';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { IndexerEnvironment } from '../src/core/indexer-interfaces';
import { benchmark } from './utils';

export async function runIndexingDensityBenchmarks() {
    console.log("=== Indexing Density Benchmarks ===");

    const extensionPath = path.resolve(__dirname, '..');
    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const config = new Config({
        getConfiguration: () => ({ get: (key: string) => key === 'searchConcurrency' ? 50 : undefined } as any)
    } as any);

    // Scenario 1: 2000 files with 1 symbol each
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-density1-'));
    for (let i = 0; i < 2000; i++) {
        fs.writeFileSync(path.join(tempDir1, `file_${i}.ts`), `export const a = 1;`);
    }
    const env1: IndexerEnvironment = {
        getWorkspaceFolders: () => [tempDir1],
        findFiles: async () => fs.readdirSync(tempDir1).map(f => path.join(tempDir1, f)),
        log: () => {},
        asRelativePath: (p) => path.relative(tempDir1, p),
        createFileSystemWatcher: () => ({ dispose: () => {} }),
        executeWorkspaceSymbolProvider: async () => [],
        executeDocumentSymbolProvider: async () => []
    };
    const indexer1 = new WorkspaceIndexer(config, parser, env1, extensionPath);

    // Scenario 2: 20 files with 100 symbols each (Same total symbols roughly)
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-density2-'));
    for (let i = 0; i < 20; i++) {
        let content = '';
        for (let j = 0; j < 100; j++) {
            content += `export class Class${i}_${j} { method() {} }\n`;
        }
        fs.writeFileSync(path.join(tempDir2, `file_${i}.ts`), content);
    }
    const env2: IndexerEnvironment = {
        getWorkspaceFolders: () => [tempDir2],
        findFiles: async () => fs.readdirSync(tempDir2).map(f => path.join(tempDir2, f)),
        log: () => {},
        asRelativePath: (p) => path.relative(tempDir2, p),
        createFileSystemWatcher: () => ({ dispose: () => {} }),
        executeWorkspaceSymbolProvider: async () => [],
        executeDocumentSymbolProvider: async () => []
    };
    const indexer2 = new WorkspaceIndexer(config, parser, env2, extensionPath);

    try {
        await benchmark(`Many Small Files (2000 files, 1 symbol each)`, async () => {
            await indexer1.indexWorkspace();
        }, 3);

        await benchmark(`Few Large Files (20 files, 100 symbols each)`, async () => {
            await indexer2.indexWorkspace();
        }, 3);
    } finally {
        indexer1.dispose();
        indexer2.dispose();
        fs.rmSync(tempDir1, { recursive: true, force: true });
        fs.rmSync(tempDir2, { recursive: true, force: true });
    }

    console.log("\n");
}

if (require.main === module) {
    runIndexingDensityBenchmarks();
}
