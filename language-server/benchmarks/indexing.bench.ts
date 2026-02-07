import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '../src/core/config';
import { IndexerEnvironment } from '../src/core/indexer-interfaces';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { benchmark } from './utils';

export async function runIndexingBenchmark() {
    console.log('=== Indexing Benchmarks ===');

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-bench-'));
    console.log(`Using temp dir: ${tempDir}`);

    // Generate files
    const FILE_COUNT = 1000;
    console.log(`Generating ${FILE_COUNT} files...`);
    for (let i = 0; i < FILE_COUNT; i++) {
        const content = `
        export class Class${i} {
            constructor() { console.log("Init ${i}"); }
            public method${i}() { return ${i}; }
        }
        export const variable${i} = ${i};
        `;
        fs.writeFileSync(path.join(tempDir, `file_${i}.ts`), content);
    }

    // Mock Environment
    const env: IndexerEnvironment = {
        getWorkspaceFolders: () => [tempDir],
        findFiles: async (include, exclude) => {
            // Simple glob-like simulation or just return all files
            return fs.readdirSync(tempDir).map((f) => path.join(tempDir, f));
        },
        log: (msg) => {}, // Suppress logs
        asRelativePath: (p) => path.relative(tempDir, p),
        createFileSystemWatcher: () => ({ dispose: () => {} }),
        executeWorkspaceSymbolProvider: async () => [], // Mock empty result
        executeDocumentSymbolProvider: async () => [],
    };

    const config = new Config({
        getConfiguration: (section) => {
            if (section === 'deeplens')
                return {
                    get: (key: string) => {
                        if (key === 'excludePatterns') return [];
                        if (key === 'searchConcurrency') return 20;
                        return undefined;
                    },
                } as any;
            return { get: () => undefined } as any;
        },
    } as any);

    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const indexer = new WorkspaceIndexer(config, parser, env, extensionPath);

    // We need to wait a bit for workers to potentially warm up? No, they start on demand.

    try {
        await benchmark(
            `Index ${FILE_COUNT} files`,
            async () => {
                // Force re-index
                await indexer.indexWorkspace((msg, inc) => {}, true);
            },
            3,
        );

        // --- GIT BENCHMARK ---
        console.log('Initializing git repo for git-based indexing benchmark...');
        const execSync = require('child_process').execSync;
        execSync('git init', { cwd: tempDir });
        execSync('git config user.email "bench@test.com"', { cwd: tempDir });
        execSync('git config user.name "Bench User"', { cwd: tempDir });
        execSync('git add .', { cwd: tempDir });
        execSync('git commit -m "Initial commit"', { cwd: tempDir });

        // We need a fresh indexer or reset it to ensure it detects git
        // The WorkspaceIndexer checks for git on each run (listGitFiles calls execGit)
        // But let's reset internal state just in case
        indexer.resetCaches();

        await benchmark(
            `Index ${FILE_COUNT} files (Git)`,
            async () => {
                await indexer.indexWorkspace((msg, inc) => {}, true);
            },
            3,
        );
    } catch (e) {
        console.error('Benchmark failed:', e);
    } finally {
        indexer.dispose();
        // Wait a bit for file handles to close
        await new Promise((resolve) => setTimeout(resolve, 100));
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.warn('Failed to clean up temp dir:', e);
        }
    }
}

// Auto-run if executed directly
if (require.main === module) {
    runIndexingBenchmark();
}
