import * as fs from 'node:fs';
import * as os from 'os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { Config } from '../src/core/config';
import { type IndexerEnvironment } from '../src/core/indexer-interfaces';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { benchmark } from './utils';

interface IncrementalIndexer {
    handleFileChanged(filePath: string): Promise<void>;
}

function createBenchmarkConfig(searchConcurrency: number): Config {
    return new Config({
        get: <T>(key: string, defaultValue?: T): T => {
            if (key === 'searchConcurrency') {
                return searchConcurrency as T;
            }
            if (key === 'respectGitignore') {
                return false as T;
            }
            return defaultValue as T;
        },
    });
}


function initializeGitRepo(directory: string): void {
    try {
        execSync('git init', { cwd: directory, stdio: 'ignore' });
        execSync('git add .', { cwd: directory, stdio: 'ignore' });
        execSync('git config user.email "bench@example.com"', { cwd: directory, stdio: 'ignore' });
        execSync('git config user.name "Bench"', { cwd: directory, stdio: 'ignore' });
        execSync('git commit -m "initial"', { cwd: directory, stdio: 'ignore' });
    } catch {
        // Optional in constrained environments.
    }
}

export async function runIndexingBatchBenchmarks(): Promise<void> {
    console.log('=== Indexing Batch Update Benchmarks ===');

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-batch-bench-'));

    const fileCount = 2000;
    for (let i = 0; i < fileCount; i++) {
        fs.writeFileSync(path.join(tempDir, `file_${i}.ts`), `export class Class${i} {}`);
    }

    const env: IndexerEnvironment = {
        getWorkspaceFolders: () => [tempDir],
        findFiles: async () => fs.readdirSync(tempDir).map((fileName) => path.join(tempDir, fileName)),
        log: () => {},
        asRelativePath: (filePath) => path.relative(tempDir, filePath),
        createFileSystemWatcher: () => ({ dispose: () => {} }),
        executeWorkspaceSymbolProvider: async () => [],
        executeDocumentSymbolProvider: async () => [],
    };

    initializeGitRepo(tempDir);

    const config = createBenchmarkConfig(50);
    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const indexer = new WorkspaceIndexer(config, parser, env, extensionPath);
    const incrementalIndexer = indexer as unknown as IncrementalIndexer;
    await indexer.indexWorkspace();

    try {
        const batchSize = 500;
        await benchmark(
            `Batch Update ${batchSize} files`,
            async () => {
                const updates: Promise<void>[] = [];
                for (let i = 0; i < batchSize; i++) {
                    const filePath = path.join(tempDir, `file_${i}.ts`);
                    fs.writeFileSync(filePath, `export class Class${i} { public updated${Math.random()}() {} }`);
                    updates.push(incrementalIndexer.handleFileChanged(filePath));
                }
                await Promise.all(updates);
            },
            2,
        );
    } finally {
        indexer.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log('\n');
}

if (require.main === module) {
    runIndexingBatchBenchmarks();
}
