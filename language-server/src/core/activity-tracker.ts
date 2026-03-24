import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { SearchableItem, SearchResult, SearchScope } from './types';

/**
 * Record of user activity for a specific item (file or symbol)
 */
export interface ActivityRecord {
    itemId: string; // Unique identifier (file path or symbol ID)
    lastAccessed: number; // Timestamp of last access
    accessCount: number; // Total number of accesses
    score: number; // Calculated activity score (0-1)
    item?: SearchableItem; // Optional: stored item for history reconstruction
}

/**
 * Interface for activity persistence
 */
export interface ActivityStorage {
    load(): Promise<Record<string, ActivityRecord> | undefined>;
    save(data: Record<string, ActivityRecord>): Promise<void>;
}

/**
 * Tracks user activity to personalize search results and provide history
 */
export class ActivityTracker {
    private readonly activities: Map<string, ActivityRecord> = new Map();
    private readonly storage: ActivityStorage;
    private saveTimer: NodeJS.Timeout | null = null;
    private readonly STORAGE_KEY = 'deeplens.activity';
    private readonly SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private readonly DECAY_DAYS = 30;
    private maxAccessCount = 1;

    // Coalescing save operations
    private needsSave = false;
    private savePromise: Promise<void> | null = null;
    private readonly initPromise: Promise<void>;

    constructor(
        storageOrContext:
            | string
            | {
                  workspaceState: {
                      get<T>(key: string): T | undefined;
                      update(key: string, value: unknown): PromiseLike<void>;
                  };
              },
    ) {
        if (typeof storageOrContext === 'string') {
            const storagePath = storageOrContext;
            this.storage = {
                load: async () => {
                    const file = join(storagePath, 'activity.json');
                    try {
                        const content = await fsPromises.readFile(file, 'utf8');
                        return JSON.parse(content);
                    } catch {
                        // Fallback to no logger if not available yet
                        return undefined;
                    }
                },
                save: async (data) => {
                    const file = join(storagePath, 'activity.json');
                    try {
                        await fsPromises.mkdir(storagePath, { recursive: true });
                        await fsPromises.writeFile(file, JSON.stringify(data));
                    } catch {
                        // Safe to ignore or log to file if we had a reference
                    }
                },
            };
        } else {
            const context = storageOrContext;
            this.storage = {
                load: async () => context.workspaceState.get(this.STORAGE_KEY),
                save: async (data) => {
                    await context.workspaceState.update(this.STORAGE_KEY, data);
                },
            };
        }

        // eslint-disable-next-line sonarjs/no-async-constructor
        this.initPromise = this.loadActivities();
        this.startPeriodicSave();
    }

    /**
     * Wait for activities to be loaded (mainly for testing/benchmarking)
     */
    async waitForLoaded(): Promise<void> {
        await this.initPromise;
    }

    /**
     * Record access to an item
     */
    recordAccess(item: SearchableItem): void {
        this.initPromise.then(() => this.doRecordAccess(item)).catch(() => {});
    }

    private doRecordAccess(item: SearchableItem): void {
        const now = Date.now();
        const existing = this.activities.get(item.id);
        let record: ActivityRecord;

        if (existing) {
            existing.lastAccessed = now;
            existing.accessCount += 1;
            existing.item = item;
            record = existing;
        } else {
            record = {
                itemId: item.id,
                lastAccessed: now,
                accessCount: 1,
                item: item,
                score: 0,
            };
            this.activities.set(item.id, record);
        }

        if (record.accessCount > this.maxAccessCount) {
            this.maxAccessCount = record.accessCount;
        }

        record.score = this.calculateScore(record, this.maxAccessCount);
    }

    /**
     * Get activity score for an item (0-1, higher = more frequently/recently used)
     */
    getActivityScore(itemId: string): number {
        const activity = this.activities.get(itemId);
        // Calculate on-the-fly to ensure accuracy against current maxAccessCount
        return activity ? this.calculateScore(activity, this.maxAccessCount) : 0;
    }

    /**
     * Get the most recent item IDs sorted by score
     */
    getRecentItemIds(count: number): string[] {
        // Refresh scores before sorting to ensure relative order is correct
        this.recalculateAllScores();

        const sorted = Array.from(this.activities.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, count);

        return sorted.map((r) => r.itemId);
    }

    /**
     * Get the most recent items sorted by recency
     */
    getRecentItems(count: number): SearchResult[] {
        const sorted = Array.from(this.activities.values())
            .filter((a) => a.item)
            .sort((a, b) => b.lastAccessed - a.lastAccessed)
            .slice(0, count);

        return sorted.map((a) => {
            const item = { ...a.item };
            const relativeTime = this.getRelativeTime(a.lastAccessed);

            // Append relative time to detail
            if (item.detail) {
                item.detail = `${item.detail} • Accessed ${relativeTime}`;
            } else {
                item.detail = `Accessed ${relativeTime}`;
            }

            return {
                item,
                score: 2,
                scope: SearchScope.EVERYTHING,
            };
        });
    }

    private getRelativeTime(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) {
            return 'just now';
        } else if (minutes < 60) {
            return `${minutes}m ago`;
        } else if (hours < 24) {
            return `${hours}h ago`;
        } else if (days === 1) {
            return 'yesterday';
        } else {
            return `${days}d ago`;
        }
    }

    /**
     * Calculate activity score based on recency and frequency
     */
    private calculateScore(record: ActivityRecord, maxAccessCount?: number): number {
        const now = Date.now();
        const daysSinceLastAccess = (now - record.lastAccessed) / (1000 * 60 * 60 * 24);

        // Recency score: decays over time
        // 1.0 for today, 0.5 for ~1 day ago, approaches 0 for old items
        const recencyScore = 1 / (1 + daysSinceLastAccess);

        // Frequency score: normalized by max access count
        const max = maxAccessCount ?? this.maxAccessCount;
        const frequencyScore = max > 0 ? record.accessCount / max : 0;

        // Weighted combination: recency matters more than frequency
        return recencyScore * 0.6 + frequencyScore * 0.4;
    }

    /**
     * Recalculate all activity scores
     */
    private recalculateAllScores(): void {
        let max = 1;
        for (const record of this.activities.values()) {
            if (record.accessCount > max) {
                max = record.accessCount;
            }
        }
        this.maxAccessCount = max;

        for (const record of this.activities.values()) {
            record.score = this.calculateScore(record, max);
        }
    }

    /**
     * Remove old activity records
     */
    private cleanupOldActivity(): void {
        const now = Date.now();
        const decayThreshold = now - this.DECAY_DAYS * 24 * 60 * 60 * 1000;

        for (const [itemId, record] of this.activities.entries()) {
            if (record.lastAccessed < decayThreshold) {
                this.activities.delete(itemId);
            }
        }
    }

    /**
     * Load activities from storage
     */
    private async loadActivities(): Promise<void> {
        try {
            const stored = await this.storage.load();

            if (stored && typeof stored === 'object') {
                const loadedActivities = new Map(Object.entries(stored));

                // Merge loaded data into current activities to handle race conditions
                // where items were accessed before loading completed
                for (const [id, loadedRecord] of loadedActivities) {
                    const currentRecord = this.activities.get(id);
                    if (currentRecord) {
                        // Merge: add historical access count to current session count
                        currentRecord.accessCount += loadedRecord.accessCount;
                        // lastAccessed in currentRecord is guaranteed to be newer or equal
                    } else {
                        this.activities.set(id, loadedRecord);
                    }
                }

                this.cleanupOldActivity();
                this.recalculateAllScores();
            }
        } catch {
            // Safe ignore
        }
    }

    /**
     * Save activities to storage
     */
    async saveActivities(): Promise<void> {
        this.needsSave = true;

        this.savePromise ??= this.runSaveLoop();

        return this.savePromise;
    }

    private async runSaveLoop(): Promise<void> {
        try {
            while (this.needsSave) {
                this.needsSave = false;
                // Periodic recalculation to apply decay
                this.recalculateAllScores();

                const data: Record<string, ActivityRecord> = {};
                for (const [key, value] of this.activities.entries()) {
                    data[key] = value;
                }

                await this.storage.save(data);
            }
        } catch {
            // Safe ignore
        } finally {
            this.savePromise = null;
        }
    }

    /**
     * Start periodic saving
     */
    private startPeriodicSave(): void {
        this.saveTimer = setInterval(() => {
            this.saveActivities();
        }, this.SAVE_INTERVAL);
    }

    /**
     * Get statistics about tracked activities
     */
    getStats(): { totalRecords: number; averageScore: number } {
        const totalRecords = this.activities.size;
        let totalScore = 0;

        for (const record of this.activities.values()) {
            totalScore += record.score;
        }

        return {
            totalRecords,
            averageScore: totalRecords > 0 ? totalScore / totalRecords : 0,
        };
    }

    /**
     * Remove a specific item from activity history
     */
    async removeItem(itemId: string): Promise<void> {
        if (this.activities.has(itemId)) {
            this.activities.delete(itemId);
            await this.saveActivities();
        }
    }

    /**
     * Clear all activity data
     */
    async clearAll(): Promise<void> {
        this.activities.clear();
        await this.saveActivities();
    }

    /**
     * Dispose resources
     */
    async dispose(): Promise<void> {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        // Final save before disposal - wait for completion
        await this.saveActivities();
    }
}
