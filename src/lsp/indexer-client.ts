import * as path from 'path';
import { glob } from 'glob';
import { IndexerEnvironment } from '../core/indexer-interfaces';
import { Connection } from 'vscode-languageserver/node';

export class LspIndexerEnvironment implements IndexerEnvironment {
    private connection: Connection;
    private workspaceFolders: string[];

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
            // Convert pattern to absolute glob if needed
            const absoluteInclude = path.isAbsolute(include) ? include : path.join(folder, include);
            // Replace backslashes with forward slashes for glob
            const globPattern = absoluteInclude.replace(/\\/g, '/');

            const files = await glob(globPattern, {
                ignore: exclude ? exclude.replace(/\\/g, '/') : undefined,
                cwd: folder,
                absolute: true,
                nodir: true,
            });

            results.push(...(files as string[]));
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
    createFileSystemWatcher = undefined;
}
