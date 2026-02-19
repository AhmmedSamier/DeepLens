import { glob } from 'glob';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, FileChangeType } from 'vscode-languageserver/node';
import { IndexerEnvironment } from './core/indexer-interfaces';

export class LspIndexerEnvironment implements IndexerEnvironment {
    private readonly connection: Connection;
    private readonly workspaceFolders: string[];

    constructor(connection: Connection, workspaceFolders: string[]) {
        this.connection = connection;
        this.workspaceFolders = workspaceFolders;
    }

    getWorkspaceFolders(): string[] {
        return this.workspaceFolders;
    }

    async findFiles(include: string, exclude: string): Promise<string[]> {
        const results: string[] = [];
        for (const folder of this.workspaceFolders) {
            const absoluteInclude = path.isAbsolute(include) ? include : path.join(folder, include);
            const globPattern = absoluteInclude.replaceAll('\\', '/');

            const ignorePattern = exclude ? exclude.replaceAll('\\', '/') : undefined;

            const files = await glob(globPattern, {
                ignore: ignorePattern,
                cwd: folder,
                absolute: true,
                nodir: true,
            });

            results.push(...files);
        }
        return results;
    }

    asRelativePath(filePath: string): string {
        for (const folder of this.workspaceFolders) {
            if (filePath.startsWith(folder)) {
                return path.relative(folder, filePath);
            }
        }
        return filePath;
    }

    log(message: string): void {
        this.connection.console.log(`[Indexer] ${message}`);
    }

    // Standard LSP server doesn't have easy access to other LSP servers' symbols
    // without significant extra work. For now, we rely 100% on Tree-sitter.
    executeDocumentSymbolProvider = undefined;
    executeWorkspaceSymbolProvider = undefined;

    createFileSystemWatcher = (
        pattern: string,
        onEvent: (path: string, type: 'create' | 'change' | 'delete') => void,
    ) => {
        return this.connection.onDidChangeWatchedFiles((params) => {
            for (const change of params.changes) {
                let type: 'create' | 'change' | 'delete';
                switch (change.type) {
                    case FileChangeType.Created:
                        type = 'create';
                        break;
                    case FileChangeType.Changed:
                        type = 'change';
                        break;
                    case FileChangeType.Deleted:
                        type = 'delete';
                        break;
                    default:
                        continue;
                }

                const uri = change.uri;
                let filePath = uri;
                if (uri.startsWith('file://')) {
                    try {
                        filePath = fileURLToPath(uri);
                    } catch {
                        filePath = decodeURIComponent(uri.slice(7));
                    }
                }
                filePath = path.normalize(filePath);

                onEvent(filePath, type);
            }
        });
    };
}
