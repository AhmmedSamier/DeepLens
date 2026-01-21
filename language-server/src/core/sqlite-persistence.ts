import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { CacheData } from './types';

export class SQLitePersistence {
    private db: Database.Database | undefined;
    private storagePath: string;
    private insertStmt: Database.Statement | undefined;
    private getStmt: Database.Statement | undefined;
    private deleteStmt: Database.Statement | undefined;
    private countStmt: Database.Statement | undefined;

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
    init(): void {
        const dbPath = this.getDbPath();
        try {
            this.db = new Database(dbPath);
            this.db.pragma('journal_mode = WAL'); // Faster writes, concurrency friendly

            this.db.exec(`
                CREATE TABLE IF NOT EXISTS files (
                    path TEXT PRIMARY KEY,
                    mtime INTEGER,
                    hash TEXT,
                    symbols TEXT
                )
            `);

            this.prepareStatements();
        } catch (error) {
            console.error('Failed to initialize SQLite persistence:', error);
        }
    }

    private prepareStatements() {
        if (!this.db) return;
        this.insertStmt = this.db.prepare('INSERT OR REPLACE INTO files (path, mtime, hash, symbols) VALUES (?, ?, ?, ?)');
        this.getStmt = this.db.prepare('SELECT mtime, hash, symbols FROM files WHERE path = ?');
        this.deleteStmt = this.db.prepare('DELETE FROM files WHERE path = ?');
        this.countStmt = this.db.prepare('SELECT COUNT(*) as count FROM files');
    }

    /**
     * Get cached data for a file
     */
    get(filePath: string): CacheData | undefined {
        if (!this.db || !this.getStmt) return undefined;
        try {
            const row = this.getStmt.get(filePath) as { mtime: number, hash: string, symbols: string } | undefined;
            if (!row) return undefined;

            return {
                mtime: Number(row.mtime), // Ensure number
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
        if (!this.db || !this.insertStmt) return;
        try {
            this.insertStmt.run(filePath, data.mtime, data.hash || null, JSON.stringify(data.symbols));
        } catch (e) {
            console.error(`Failed to set cache for ${filePath}:`, e);
        }
    }

    /**
     * Insert multiple items in a single transaction
     */
    insertBatch(items: { filePath: string; data: CacheData }[]): void {
        if (!this.db || !this.insertStmt) return;

        try {
            const insert = this.insertStmt;
            const transaction = this.db.transaction((itemsToInsert: { filePath: string; data: CacheData }[]) => {
                for (const item of itemsToInsert) {
                    insert.run(item.filePath, item.data.mtime, item.data.hash || null, JSON.stringify(item.data.symbols));
                }
            });
            transaction(items);
        } catch (e) {
            console.error('Failed to insert batch:', e);
        }
    }

    /**
     * Delete cache for a file
     */
    delete(filePath: string): void {
        if (!this.db || !this.deleteStmt) return;
        try {
            this.deleteStmt.run(filePath);
        } catch (e) {
            console.error(`Failed to delete cache for ${filePath}:`, e);
        }
    }

    /**
     * Clear the entire cache (drop/recreate or delete file)
     */
    async clear(): Promise<void> {
        this.close();

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
        this.init();
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
         if (!this.db || !this.countStmt) return 0;
         try {
             const result = this.countStmt.get() as { count: number };
             return result.count;
         } catch {
             return 0;
         }
    }

    /**
     * Compatibility methods for old interface
     */
    async load(): Promise<void> {
        // No-op for SQLite, we lazy load. Just ensure init.
        if (!this.db) {
            this.init();
        }
    }

    async save(): Promise<void> {
        // No-op, we save incrementally
    }
}
