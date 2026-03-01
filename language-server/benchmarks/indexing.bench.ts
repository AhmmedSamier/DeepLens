import * as fs from 'node:fs';
import * as os from 'os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { Config } from '../src/core/config';
import { type IndexerEnvironment } from '../src/core/indexer-interfaces';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { benchmark } from './utils';

function createBenchmarkConfig(searchConcurrency: number): Config {
    return new Config({
        get: <T>(key: string, defaultValue?: T): T => {
            if (key === 'excludePatterns') {
                return [] as T;
            }
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

export async function runIndexingBenchmark(): Promise<void> {
    console.log('=== Indexing Benchmarks ===');

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-bench-'));
    console.log(`Using temp dir: ${tempDir}`);

    const fileCount = 5000;

    console.log(`Generating ${fileCount} files...`);
    for (let i = 0; i < fileCount; i++) {
        const content = `
        export class Class${i} {
            constructor() { console.log("Init ${i}"); }
            public method${i}() { return ${i}; }
        }
        export const variable${i} = ${i};
        `;
        fs.writeFileSync(path.join(tempDir, `file_${i}.ts`), content);
    }

    try {
        execSync('git init', { cwd: tempDir, stdio: 'ignore' });
        execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
        execSync('git config user.email "bench@example.com"', { cwd: tempDir, stdio: 'ignore' });
        execSync('git config user.name "Bench"', { cwd: tempDir, stdio: 'ignore' });
        execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    } catch (error) {
        console.warn('Failed to initialize git repo in temp dir, continuing without git context:', error);
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

    const config = createBenchmarkConfig(20);

    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const indexer = new WorkspaceIndexer(config, parser, env, extensionPath);

    try {
        await benchmark(
            `Index ${fileCount} files`,
            async () => {
                await indexer.indexWorkspace();
            },
            3,
        );
    } catch (error) {
        console.error('Benchmark failed:', error);
    } finally {
        indexer.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    runIndexingBenchmark();
}
