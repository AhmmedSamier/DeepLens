import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { SearchableItem } from './types';

export interface CacheData {
    mtime: number;
    hash?: string;
    symbols: SearchableItem[];
}

interface CacheEntry {
    key: string;
    value: CacheData;
}

export class IndexPersistence {
    private storagePath: string;
    private cache: Map<string, CacheData> = new Map();

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    private getCacheFile(): string {
        return path.join(this.storagePath, 'index-cache.json');
    }

    /**
     * Load cache from disk (supports NDJSON and legacy JSON)
     */
    async load(): Promise<void> {
        const file = this.getCacheFile();
        if (!fs.existsSync(file)) return;

        try {
            const fileStream = fs.createReadStream(file);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            let isLegacy = false;
            let firstLine = true;
            const legacyBuffer: string[] = [];

            for await (const line of rl) {
                if (!line.trim()) continue;

                if (firstLine) {
                    // Simple heuristic: NDJSON lines usually start with {"key":...
                    // Legacy JSON starts with { "path": ... or just {
                    // If the line is very long and starts with {, it might be legacy
                    if (line.trim().startsWith('{') && !line.includes('"key":')) {
                        // Check if it matches our new format structure roughly
                        try {
                            const testParse = JSON.parse(line);
                            if (!testParse.key || !testParse.value) {
                                isLegacy = true;
                            }
                        } catch {
                            isLegacy = true; // If first line isn't valid JSON, it might be start of multiline legacy
                        }
                    }
                    firstLine = false;
                }

                if (isLegacy) {
                    legacyBuffer.push(line);
                } else {
                    try {
                        const entry = JSON.parse(line) as CacheEntry;
                        if (entry.key && entry.value) {
                            this.cache.set(entry.key, entry.value);
                        }
                    } catch (e) {
                        // Ignore malformed lines
                    }
                }
            }

            if (isLegacy) {
                // Fallback to loading as full JSON
                const content = await fs.promises.readFile(file, 'utf8');
                const parsed = JSON.parse(content);
                this.cache = new Map(Object.entries(parsed));
            }

        } catch (error) {
            console.error('Failed to load index cache:', error);
            // Invalidate cache on error
            this.cache.clear();
        }
    }

    /**
     * Save cache to disk as NDJSON (Streamed)
     */
    async save(): Promise<void> {
        const file = this.getCacheFile();
        const tempFile = `${file}.tmp`;

        try {
            const writeStream = fs.createWriteStream(tempFile, { flags: 'w' });
            
            // Wait for stream to be ready
            await new Promise<void>((resolve, reject) => {
                writeStream.on('open', () => resolve());
                writeStream.on('error', reject);
            });

            let drainPromise: Promise<void> | null = null;

            for (const [key, value] of this.cache.entries()) {
                const entry: CacheEntry = { key, value };
                const line = JSON.stringify(entry) + '\n';
                
                if (!writeStream.write(line)) {
                    // Handle backpressure
                    if (!drainPromise) {
                        drainPromise = new Promise((resolve) => writeStream.once('drain', resolve));
                    }
                    await drainPromise;
                    drainPromise = null;
                }
            }

            writeStream.end();
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            // Atomic rename
            await fs.promises.rename(tempFile, file);

        } catch (error) {
            console.error('Failed to save index cache:', error);
            try {
                if (fs.existsSync(tempFile)) {
                    await fs.promises.unlink(tempFile);
                }
            } catch { /* ignore */ }
        }
    }

    get(filePath: string): CacheData | undefined {
        return this.cache.get(filePath);
    }

    set(filePath: string, data: CacheData): void {
        this.cache.set(filePath, data);
    }

    delete(filePath: string): void {
        this.cache.delete(filePath);
    }

    async clear(): Promise<void> {
        this.cache.clear();
        const file = this.getCacheFile();
        try {
            await fs.promises.unlink(file);
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                console.error('Failed to delete cache file:', error);
            }
        }
    }

    /**
     * Get the size of the cache file in bytes
     */
    async getCacheSize(): Promise<number> {
        const file = this.getCacheFile();
        try {
            const stats = await fs.promises.stat(file);
            return stats.size;
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                console.error('Failed to get cache size:', error);
            }
            return 0;
        }
    }
}
