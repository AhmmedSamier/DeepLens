import * as fs from 'fs';
import * as path from 'path';
import { SearchableItem } from './types';

export interface CacheData {
    mtime: number;
    hash?: string;
    symbols: SearchableItem[];
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
     * Load cache from disk
     */
    async load(): Promise<void> {
        const file = this.getCacheFile();
        try {
            // Check existence first to avoid error if file doesn't exist
            // Alternatively, just try catch ENOENT, but we use access here.
            await fs.promises.access(file, fs.constants.F_OK);
            const data = await fs.promises.readFile(file, 'utf8');
            const parsed = JSON.parse(data);
            this.cache = new Map(Object.entries(parsed));
        } catch (error: unknown) {
            // Ignore if file doesn't exist, log other errors
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                console.error('Failed to load index cache:', error);
            }
        }
    }

    /**
     * Save cache to disk
     */
    async save(): Promise<void> {
        const file = this.getCacheFile();
        try {
            const data: Record<string, CacheData> = {};
            for (const [key, value] of this.cache.entries()) {
                data[key] = value;
            }
            await fs.promises.writeFile(file, JSON.stringify(data));
        } catch (error) {
            console.error('Failed to save index cache:', error);
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
