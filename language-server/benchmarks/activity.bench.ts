import { ActivityTracker, type ActivityRecord } from '../src/core/activity-tracker';
import { SearchItemType, type SearchableItem } from '../src/core/types';
import { benchmark } from './utils';

interface BenchmarkActivityTracker {
    activities: Map<string, ActivityRecord>;
    recalculateAllScores(): void;
}

export async function runActivityBenchmarks(): Promise<void> {
    console.log('--- Activity Tracker Benchmarks ---');

    const mockStorage = {
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        },
    };

    const tracker = new ActivityTracker(mockStorage);
    const itemCount = 5000;

    // Populate tracker
    console.log(`Populating tracker with ${itemCount} items...`);
    // Manually accessing private 'activities' map for setup speed
    const benchmarkTracker = tracker as unknown as BenchmarkActivityTracker;
    const activitiesMap = benchmarkTracker.activities;

    for (let i = 0; i < itemCount; i++) {
        const item: SearchableItem = {
            id: `id-${i}`,
            name: `file-${i}`,
            type: SearchItemType.FILE,
            filePath: `/path/to/file-${i}`,
        };

        activitiesMap.set(item.id, {
            itemId: item.id,
            lastAccessed: Date.now(),
            accessCount: Math.floor(Math.random() * 100) + 1,
            score: 0,
            item,
        });
    }

    await benchmark(`recalculateAllScores (N=${itemCount})`, () => {
        benchmarkTracker.recalculateAllScores();
    }, 20);

    tracker.dispose();
}

if (import.meta.main) {
    runActivityBenchmarks();
}
