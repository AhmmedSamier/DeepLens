import * as fs from 'fs';
import * as path from 'path';

/**
 * Record of user activity for a specific item (file or symbol)
 */
export interface ActivityRecord {
    itemId: string; // Unique identifier (file path or symbol ID)
    lastAccessed: number; // Timestamp of last access
    accessCount: number; // Total number of accesses
    score: number; // Calculated activity score (0-1)
}

/**
 * Interface for activity persistence
 */
export interface ActivityStorage {
    load(): Record<string, ActivityRecord> | undefined;
    save(data: Record<string, ActivityRecord>): Promise<void>;
}

/**
 * Tracks user activity to personalize search results
 */
export class ActivityTracker {
    private activities: Map<string, ActivityRecord> = new Map();
    private storage: ActivityStorage;
    private saveTimer: NodeJS.Timeout | undefined;
    private readonly STORAGE_KEY = 'deeplens.activity';
    private readonly SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private readonly DECAY_DAYS = 30;

    constructor(storageOrContext: string | { workspaceState: { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> } }) {
        if (typeof storageOrContext === 'string') {
            const storagePath = storageOrContext;
            this.storage = {
                load: () => {
                    const file = path.join(storagePath, 'activity.json');
                    if (fs.existsSync(file)) {
                        try {
                            return JSON.parse(fs.readFileSync(file, 'utf8'));
                        } catch (e) {
                            console.error('Failed to load activity file:', e);
                        }
                    }
                    return undefined;
                },
                save: async (data) => {
                    const file = path.join(storagePath, 'activity.json');
                    try {
                        if (!fs.existsSync(storagePath)) {
                            fs.mkdirSync(storagePath, { recursive: true });
                        }
                        fs.writeFileSync(file, JSON.stringify(data));
                    } catch (e) {
                        console.error('Failed to save activity file:', e);
                    }
                }
            };
        } else {
            const context = storageOrContext;
            this.storage = {
                load: () => context.workspaceState.get(this.STORAGE_KEY),
                save: async (data) => { await context.workspaceState.update(this.STORAGE_KEY, data); }
            };
        }

        this.loadActivities();
        this.startPeriodicSave();
    }

    /**
     * Record access to an item
     */
    recordAccess(itemId: string): void {
        const now = Date.now();
        const existing = this.activities.get(itemId);

        if (existing) {
            existing.lastAccessed = now;
            existing.accessCount += 1;
            existing.score = this.calculateScore(existing);
        } else {
            this.activities.set(itemId, {
                itemId,
                lastAccessed: now,
                accessCount: 1,
                score: this.calculateScore({ itemId, lastAccessed: now, accessCount: 1, score: 0 }),
            });
        }

        // Recalculate all scores to maintain relative rankings
        this.recalculateAllScores();
    }

    /**
     * Get activity score for an item (0-1, higher = more frequently/recently used)
     */
    getActivityScore(itemId: string): number {
        const activity = this.activities.get(itemId);
        return activity ? activity.score : 0;
    }

    /**
     * Get a list of most recently accessed item IDs
     */
    getRecentItems(limit: number = 20): string[] {
        return Array.from(this.activities.values())
            .sort((a, b) => b.lastAccessed - a.lastAccessed)
            .slice(0, limit)
            .map((record) => record.itemId);
    }

    /**
     * Calculate activity score based on recency and frequency
     */
    private calculateScore(record: ActivityRecord): number {
        const now = Date.now();
        const daysSinceLastAccess = (now - record.lastAccessed) / (1000 * 60 * 60 * 24);

        // Recency score: decays over time
        // 1.0 for today, 0.5 for ~1 day ago, approaches 0 for old items
        const recencyScore = 1 / (1 + daysSinceLastAccess);

        // Frequency score: normalized by max access count
        const maxAccessCount = this.getMaxAccessCount();
        const frequencyScore = maxAccessCount > 0 ? record.accessCount / maxAccessCount : 0;

        // Weighted combination: recency matters more than frequency
        return recencyScore * 0.6 + frequencyScore * 0.4;
    }

    /**
     * Get maximum access count across all records
     */
    private getMaxAccessCount(): number {
        let max = 1; // Minimum 1 to avoid division by zero
        for (const record of this.activities.values()) {
            if (record.accessCount > max) {
                max = record.accessCount;
            }
        }
        return max;
    }

    /**
     * Recalculate all activity scores
     */
    private recalculateAllScores(): void {
        for (const record of this.activities.values()) {
            record.score = this.calculateScore(record);
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
    private loadActivities(): void {
        try {
            const stored = this.storage.load();

            if (stored) {
                this.activities = new Map(Object.entries(stored));
                this.cleanupOldActivity();
                this.recalculateAllScores();
            }
        } catch (error) {
            console.error('Failed to load activity data:', error);
        }
    }

    /**
     * Save activities to storage
     */
    async saveActivities(): Promise<void> {
        try {
            const data: Record<string, ActivityRecord> = {};
            for (const [key, value] of this.activities.entries()) {
                data[key] = value;
            }

            await this.storage.save(data);
        } catch (error) {
            console.error('Failed to save activity data:', error);
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
     * Clear all activity data
     */
    async clearAll(): Promise<void> {
        this.activities.clear();
        await this.saveActivities();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }
        // Final save before disposal
        this.saveActivities();
    }
}
