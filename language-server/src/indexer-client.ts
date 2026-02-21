import { glob } from 'glob';
import * as cp from 'node:child_process';
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
        if (include === '**/*') {
            const fastFiles = await this.findFilesWithRipgrep(exclude);
            if (fastFiles.length > 0) {
                return fastFiles;
            }
        }

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

    private async findFilesWithRipgrep(exclude: string): Promise<string[]> {
        const results: string[] = [];
        const excludes = this.parseExcludePatterns(exclude);

        for (const folder of this.workspaceFolders) {
            try {
                const files = await this.execRgFiles(folder, excludes);
                results.push(...files);
            } catch {
                return [];
            }
        }

        return results;
    }

    private parseExcludePatterns(exclude: string): string[] {
        if (!exclude || !exclude.startsWith('{') || !exclude.endsWith('}')) {
            return [];
        }

        return exclude
            .slice(1, -1)
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }

    private async execRgFiles(folder: string, excludes: string[]): Promise<string[]> {
        const args = ['--files', '--hidden'];
        for (const pattern of excludes) {
            args.push('--glob', `!${pattern}`);
        }

        const output = await new Promise<string>((resolve, reject) => {
            const child = cp.spawn('rg', args, {
                cwd: folder,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`rg exited with code ${code}: ${stderr}`));
                }
            });
        });

        return output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((relativePath) => path.join(folder, relativePath));
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
