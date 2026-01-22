import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
        const binName = process.platform === 'win32' ? 'rg.exe' : 'rg';
        // In dev/test, we might be running from src, but the binary is in dist/bin
        // When bundled (server.js in dist), ../dist/bin is just ./bin
        // We try a few locations
        const locations = [
            path.join(extensionPath, 'dist', 'bin', binName),
            path.join(extensionPath, 'bin', binName), // fallback
            path.join(__dirname, '..', '..', 'dist', 'bin', binName), // from src/core
        ];

        this.rgPath = locations.find((p) => fs.existsSync(p)) || '';
    }

    isAvailable(): boolean {
        return !!this.rgPath && fs.existsSync(this.rgPath);
    }

    async search(query: string, files: string[], maxResults: number = 100): Promise<RgMatch[]> {
        if (!this.isAvailable()) {
            throw new Error('Ripgrep binary not found');
        }

        return new Promise((resolve, reject) => {
            // Create temp file for file list
            const tmpDir = os.tmpdir();
            const fileListPath = path.join(tmpDir, `deeplens-rg-${Date.now()}.txt`);

            const writeStream = fs.createWriteStream(fileListPath, { encoding: 'utf8' });

            writeStream.on('error', (err) => {
                reject(err);
            });

            writeStream.on('finish', () => {
                const args = [
                    '--json',
                    '--case-insensitive',
                    '--files-from',
                    fileListPath,
                    '--max-count',
                    maxResults.toString(),
                    '--',
                    query,
                ];

                const child = cp.spawn(this.rgPath, args, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                const results: RgMatch[] = [];
                let buffer = '';
                let errorBuffer = '';
                let hitLimit = false;

                child.stdout.on('data', (chunk: Buffer) => {
                    if (hitLimit) return;

                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const msg = JSON.parse(line);
                            if (msg.type === 'match') {
                                const data = msg.data;
                                results.push({
                                    path: data.path.text,
                                    line: data.line_number - 1, // rg is 1-based
                                    column: data.submatches[0]?.start || 0,
                                    text: data.lines.text.trim(),
                                    match: data.submatches[0]?.match?.text || '',
                                    submatches: data.submatches,
                                });

                                if (results.length >= maxResults) {
                                    hitLimit = true;
                                    child.kill();
                                    break;
                                }
                            }
                        } catch {
                            // ignore parse errors
                        }
                    }
                });

                child.stderr.on('data', (chunk) => {
                    errorBuffer += chunk.toString();
                });

                child.on('close', (code) => {
                    try {
                        if (fs.existsSync(fileListPath)) {
                            fs.unlinkSync(fileListPath);
                        }
                    } catch {}

                    if (hitLimit || code === 0 || code === 1) {
                        // 1 means no matches found
                        resolve(results);
                    } else {
                        reject(new Error(`Ripgrep failed with code ${code}: ${errorBuffer}`));
                    }
                });

                child.on('error', (err) => {
                    try {
                        if (fs.existsSync(fileListPath)) {
                            fs.unlinkSync(fileListPath);
                        }
                    } catch {}
                    reject(err);
                });
            });

            // Write files to stream
            files.forEach((f) => writeStream.write(f + '\n'));
            writeStream.end();
        });
    }
}
