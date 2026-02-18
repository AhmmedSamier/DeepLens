import * as fs from 'node:fs';
import * as os from 'os';
import * as path from 'node:path';
import { Config } from '../src/core/config';
import { IndexerEnvironment } from '../src/core/indexer-interfaces';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { WorkspaceIndexer } from '../src/core/workspace-indexer';
import { benchmark } from './utils';

export async function runIndexingFileExtensionsBenchmarks() {
    console.log('=== Indexing File Extensions Benchmarks ===');

    const extensionPath = path.resolve(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-extensions-bench-'));

    const totalFiles = 4000;
    const tsFiles = totalFiles / 2;
    const binFiles = totalFiles - tsFiles;

    console.log(`Generating ${tsFiles} .ts files and ${binFiles} .bin files in ${tempDir}...`);

    for (let i = 0; i < tsFiles; i++) {
        const content = `
        export class Class${i} {
            constructor() { console.log("Init ${i}"); }
            public method${i}() { return ${i}; }
        }
        export const variable${i} = ${i};
        `;
        fs.writeFileSync(path.join(tempDir, `file_${i}.ts`), content);
    }

    for (let i = 0; i < binFiles; i++) {
        const content = Buffer.alloc(1024, i % 256);
        fs.writeFileSync(path.join(tempDir, `file_${i}.bin`), content);
    }

    const env: IndexerEnvironment = {
        getWorkspaceFolders: () => [tempDir],
        findFiles: async () => fs.readdirSync(tempDir).map((f) => path.join(tempDir, f)),
        log: () => {},
        asRelativePath: (p) => path.relative(tempDir, p),
        createFileSystemWatcher: () => ({ dispose: () => {} }),
        executeWorkspaceSymbolProvider: async () => [],
        executeDocumentSymbolProvider: async () => [],
    };

    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const configWide = new Config();
    configWide.update({ fileExtensions: ['ts', 'bin'] });

    const configTsOnly = new Config();
    configTsOnly.update({ fileExtensions: ['ts'] });

    const indexerWide = new WorkspaceIndexer(configWide, parser, env, extensionPath);
    const indexerTsOnly = new WorkspaceIndexer(configTsOnly, parser, env, extensionPath);

    try {
        await benchmark(
            `Mixed extensions (ts+bin) with fileExtensions=['ts','bin']`,
            async () => {
                await indexerWide.indexWorkspace();
            },
            3,
        );

        await benchmark(
            `Mixed extensions (ts+bin) with fileExtensions=['ts']`,
            async () => {
                await indexerTsOnly.indexWorkspace();
            },
            3,
        );
    } finally {
        indexerWide.dispose();
        indexerTsOnly.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    runIndexingFileExtensionsBenchmarks();
}

