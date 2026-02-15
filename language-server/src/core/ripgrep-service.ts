import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CancellationToken } from 'vscode-languageserver';

export interface RgMatch {
    path: string;
    line: number;
    column: number;
    text: string;
    match: string;
    submatches: { match: { text: string }; start: number; end: number }[];
}

export class RipgrepService {
    private rgPath: string;

    constructor(extensionPath: string) {
        let binPatterns: string[] = [];

        // Determine target binary names based on platform/arch
        if (process.platform === 'win32') {
            binPatterns = ['rg.exe'];
        } else if (process.platform === 'linux') {
            binPatterns = ['rg-linux-x64', 'rg-linux', 'rg'];
        } else if (process.platform === 'darwin') {
            binPatterns = ['rg-darwin-arm64', 'rg-darwin-x64', 'rg-darwin', 'rg'];
        } else {
            binPatterns = ['rg'];
        }

        // Potential search locations
        const searchDirs = [
            path.join(extensionPath, 'dist', 'bin'),
            path.join(extensionPath, 'bin'),
            path.join(__dirname, '..', '..', 'dist', 'bin'),
        ];

        // Find the first matching binary
        this.rgPath = '';

        for (const dir of searchDirs) {
            for (const name of binPatterns) {
                const candidate = path.join(dir, name);
                if (fs.existsSync(candidate)) {
                    this.rgPath = candidate;
                    break;
                }
            }
            if (this.rgPath) break;
        }
    }

    isAvailable(): boolean {
        return !!this.rgPath && fs.existsSync(this.rgPath);
    }

    async search(
        query: string,
        files: string[],
        maxResults: number = 100,
        token?: CancellationToken,
    ): Promise<RgMatch[]> {
        if (!this.isAvailable()) {
            throw new Error('Ripgrep binary not found');
        }

        const baseArgs = [
            '--json',
            '-i',
            '-F', // Fixed strings (no regex)
            '--max-count', // Note: this is per-file, but helps performance
            maxResults.toString(),
            '--',
            query,
        ];

        // Calculate rough base length (ignoring escaping overhead for now, safe margin handles it)
        const baseArgsLen = baseArgs.reduce((acc, arg) => acc + arg.length + 1, 0);

        // Windows command line limit is ~32k. We'll use 20k to be safe.
        const MAX_CMD_LENGTH = 20000;

        const batches: string[][] = [];
        let currentBatch: string[] = [];
        let currentBatchLen = baseArgsLen;

        for (const file of files) {
            // +1 for space/quote overhead
            if (currentBatchLen + file.length + 1 > MAX_CMD_LENGTH) {
                batches.push(currentBatch);
                currentBatch = [];
                currentBatchLen = baseArgsLen;
            }
            currentBatch.push(file);
            currentBatchLen += file.length + 1;
        }
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        const allResults: RgMatch[] = [];

        // Process batches sequentially to respect maxResults
        for (const batch of batches) {
            if (allResults.length >= maxResults || token?.isCancellationRequested) break;

            try {
                const batchResults = await this.runRgBatch(baseArgs, batch, maxResults - allResults.length, token);
                allResults.push(...batchResults);
            } catch {
                // Ignore batch failure
            }
        }

        return allResults;
    }

    private runRgBatch(
        baseArgs: string[],
        files: string[],
        limit: number,
        token?: CancellationToken,
    ): Promise<RgMatch[]> {
        return new Promise((resolve, reject) => {
            if (token?.isCancellationRequested) {
                resolve([]);
                return;
            }

            // Append files to args
            const args = [...baseArgs, ...files];

            const child = cp.spawn(this.rgPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'], // No stdin needed
            });

            // Handle immediate cancellation
            const cancellationListener = token?.onCancellationRequested(() => {
                child.kill();
                resolve(results);
            });

            const results: RgMatch[] = [];
            let buffer = '';
            let errorBuffer = '';
            let hitLimit = false;

            child.stdout.on('data', (chunk: Buffer) => {
                if (hitLimit || token?.isCancellationRequested) return;

                buffer += chunk.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === 'match') {
                            const data = msg.data;
                            // Ripgrep returns byte offsets into the original UTF-8 string.
                            const rawText = data.lines.text;

                            // Calculate leading whitespace (bytes)
                            // We need to match leading whitespace and count its *bytes* because rg offsets are bytes.
                            const leadingMatch = rawText.match(/^\s*/);
                            const leadingStr = leadingMatch ? leadingMatch[0] : '';
                            const leadingBytes = Buffer.byteLength(leadingStr);

                            // Trim text for display
                            const trimmedText = rawText.trimStart().trimEnd(); // Matches behaviors of .trim()

                            // Adjust submatches
                            const adjustedSubmatches = data.submatches.map((sm: { start: number; end: number }) => ({
                                ...sm,
                                start: Math.max(0, sm.start - leadingBytes),
                                end: Math.max(0, sm.end - leadingBytes),
                            }));

                            results.push({
                                path: data.path.text,
                                line: data.line_number - 1,
                                column: data.submatches[0]?.start || 0, // Original Column
                                text: trimmedText,
                                match: data.submatches[0]?.match?.text || '',
                                submatches: adjustedSubmatches,
                            });

                            if (results.length >= limit) {
                                hitLimit = true;
                                child.kill();
                                break;
                            }
                        }
                    } catch {
                        // ignore
                    }
                }
            });

            child.stderr.on('data', (chunk) => {
                errorBuffer += chunk.toString();
            });

            child.on('close', (code) => {
                if (cancellationListener) cancellationListener.dispose();
                if (hitLimit || token?.isCancellationRequested || code === 0 || code === 1) {
                    resolve(results);
                } else {
                    reject(new Error(`Ripgrep failed with code ${code}: ${errorBuffer}`));
                }
            });

            child.on('error', (err) => {
                if (cancellationListener) cancellationListener.dispose();
                reject(err);
            });
        });
    }
}
