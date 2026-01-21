import initSqlite, { Database } from '@sqlite.org/sqlite-wasm';
import * as path from 'path';
import * as fs from 'fs';
import { CacheData } from './types';

export class SQLitePersistence {
    private db: Database | undefined;
    private storagePath: string;
    private initPromise: Promise<void> | undefined;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    private getDbPath(): string {
        return path.join(this.storagePath, 'index.db');
    }

    /**
     * Open the database
     */
    async init(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                // Ensure we pass the correct location of the WASM file
                // In the bundled server, __dirname points to 'dist' where sqlite3.wasm is copied
                const sqlite3 = await initSqlite({
                    wasmFile: path.join(__dirname, 'sqlite3.wasm')
                } as any); // cast to any as types might not expose locateFile directly in this version wrapper

                const dbPath = this.getDbPath();

                // oo1: Object Oriented 1 API (synchronous-like wrapper)
                if ('opfs' in sqlite3) {
                     // In Node.js environment we use direct file system via 'kvvfs' or default if available?
                     // sqlite-wasm in Node usually requires some polyfills or specific handling.
                     // But strictly speaking, the basic WASM build works in Node if we provide the right file IO.
                     // However, @sqlite.org/sqlite-wasm tries to detect environment.

                     // For VS Code extension (Node/Electron), we should check if we can use the default filename.
                     this.db = new sqlite3.oo1.DB(dbPath, 'c');
                } else {
                     // Fallback
                     this.db = new sqlite3.oo1.DB(dbPath, 'c');
                }

                this.db.exec([
                    'PRAGMA journal_mode = WAL;',
                    `CREATE TABLE IF NOT EXISTS files (
                        path TEXT PRIMARY KEY,
                        mtime INTEGER,
                        hash TEXT,
                        symbols TEXT
                    );`
                ]);
            } catch (error) {
                console.error('Failed to initialize SQLite persistence:', error);
                this.db = undefined;
            }
        })();

        return this.initPromise;
    }

    /**
     * Get cached data for a file
     */
    get(filePath: string): CacheData | undefined {
        if (!this.db) return undefined;
        try {
            // exec returns array of rows. bind uses ? params.
            const rows = this.db.exec({
                sql: 'SELECT mtime, hash, symbols FROM files WHERE path = ?',
                bind: [filePath],
                returnValue: 'resultRows',
                rowMode: 'object'
            });

            if (rows.length === 0) return undefined;
            const row = rows[0] as any;

            return {
                mtime: Number(row.mtime),
                hash: row.hash,
                symbols: JSON.parse(row.symbols)
            };
        } catch (e) {
            console.error(`Failed to get/parse cache for ${filePath}:`, e);
            return undefined;
        }
    }

    /**
     * Set cached data for a file
     */
    set(filePath: string, data: CacheData): void {
        if (!this.db) return;
        try {
            this.db.exec({
                sql: 'INSERT OR REPLACE INTO files (path, mtime, hash, symbols) VALUES (?, ?, ?, ?)',
                bind: [filePath, data.mtime, data.hash || null, JSON.stringify(data.symbols)]
            });
        } catch (e) {
            console.error(`Failed to set cache for ${filePath}:`, e);
        }
    }

    /**
     * Insert multiple items in a single transaction
     */
    insertBatch(items: { filePath: string; data: CacheData }[]): void {
        if (!this.db) return;

        try {
            this.db.transaction(() => {
                for (const item of items) {
                     this.db!.exec({
                        sql: 'INSERT OR REPLACE INTO files (path, mtime, hash, symbols) VALUES (?, ?, ?, ?)',
                        bind: [item.filePath, item.data.mtime, item.data.hash || null, JSON.stringify(item.data.symbols)]
                    });
                }
            });
        } catch (e) {
            console.error('Failed to insert batch:', e);
        }
    }

    /**
     * Delete cache for a file
     */
    delete(filePath: string): void {
        if (!this.db) return;
        try {
             this.db.exec({
                sql: 'DELETE FROM files WHERE path = ?',
                bind: [filePath]
            });
        } catch (e) {
            console.error(`Failed to delete cache for ${filePath}:`, e);
        }
    }

    /**
     * Clear the entire cache
     */
    async clear(): Promise<void> {
        this.close();
        this.initPromise = undefined;

        const dbPath = this.getDbPath();
        const extensions = ['', '-wal', '-shm'];

        for (const ext of extensions) {
            const file = dbPath + ext;
            if (fs.existsSync(file)) {
                try {
                    await fs.promises.unlink(file);
                } catch (error: any) {
                     if (error.code !== 'ENOENT') {
                        console.error(`Failed to delete cache file ${file}:`, error);
                    }
                }
            }
        }

        // Re-initialize
        await this.init();
    }

    /**
     * Close the database connection
     */
    close(): void {
        if (this.db) {
            try {
                this.db.close();
            } catch (e) {
                console.error('Error closing database:', e);
            }
            this.db = undefined;
        }
    }

    /**
     * Get the size of the cache file in bytes
     */
    async getCacheSize(): Promise<number> {
        const file = this.getDbPath();
        try {
            const stats = await fs.promises.stat(file);
            return stats.size;
        } catch (error: any) {
            return 0;
        }
    }

    /**
     * Get total item count (for stats)
     */
    getItemCount(): number {
         if (!this.db) return 0;
         try {
             const result = this.db.exec({
                 sql: 'SELECT COUNT(*) as count FROM files',
                 returnValue: 'resultRows',
                 rowMode: 'object'
             });
             return (result[0] as any).count;
         } catch {
             return 0;
         }
    }
}
