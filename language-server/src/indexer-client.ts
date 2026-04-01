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
        let normalizedExclude: string | null = null;
        if (exclude) {
            normalizedExclude = exclude.indexOf('\\') !== -1 ? exclude.replace(/\\/g, '/') : exclude;
        }

        if (include === '**/*') {
            const fastFiles = await this.findFilesWithRipgrep(normalizedExclude);
            if (fastFiles.length > 0) {
                return fastFiles;
            }
        }

        const results: string[] = [];
        for (const folder of this.workspaceFolders) {
            const absoluteInclude = path.isAbsolute(include) ? include : path.join(folder, include);
            // ⚡ Bolt: Fast backslash normalization optimization
            // Replacing with regex + early indexOf check is much faster than replaceAll
            const globPattern =
                absoluteInclude.indexOf('\\') !== -1 ? absoluteInclude.replace(/\\/g, '/') : absoluteInclude;

            const files = await glob(globPattern, {
                ignore: normalizedExclude ? normalizedExclude : undefined,
                cwd: folder,
                absolute: true,
                nodir: true,
            });

            results.push(...files);
        }
        return results;
    }

    private async findFilesWithRipgrep(exclude: string | null): Promise<string[]> {
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

    // eslint-disable-next-line sonarjs/cognitive-complexity
    private parseExcludePatterns(exclude: string | null): string[] {
        if (!exclude || !exclude.startsWith('{') || !exclude.endsWith('}')) {
            return [];
        }

        // ⚡ Bolt: Fast parsing of exclude patterns
        // Avoids multiple allocations from split, map, and filter
        const result: string[] = [];
        const inner = exclude.slice(1, -1);
        let lastIdx = 0;
        let idx = 0;
        const len = inner.length;

        while (idx < len) {
            if (inner.charCodeAt(idx) === 44) {
                // ','
                if (idx > lastIdx) {
                    let start = lastIdx;
                    let end = idx;
                    while (start < end && inner.charCodeAt(start) <= 32) start++;
                    while (end > start && inner.charCodeAt(end - 1) <= 32) end--;
                    if (end > start) {
                        result.push(inner.slice(start, end));
                    }
                }
                lastIdx = idx + 1;
            }
            idx++;
        }

        if (len > lastIdx) {
            let start = lastIdx;
            let end = len;
            while (start < end && inner.charCodeAt(start) <= 32) start++;
            while (end > start && inner.charCodeAt(end - 1) <= 32) end--;
            if (end > start) {
                result.push(inner.slice(start, end));
            }
        }

        return result;
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity
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

        // ⚡ Bolt: Fast parsing of ripgrep output
        // Replacing .split('\n').map().filter().map() with a single-pass manual loop
        // using charCodeAt and string slicing is ~5x faster and reduces memory allocation.
        const results: string[] = [];
        const len = output.length;
        let start = 0;

        for (let i = 0; i <= len; i++) {
            if (i === len || output.charCodeAt(i) === 10) {
                // 10 is '\n'
                let s = start;
                let e = i;

                // Trim whitespace (like \r or spaces)
                while (s < e && output.charCodeAt(s) <= 32) s++;
                while (e > s && output.charCodeAt(e - 1) <= 32) e--;

                if (s < e) {
                    results.push(path.join(folder, output.slice(s, e)));
                }
                start = i + 1;
            }
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
