import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActivityTracker } from '../src/core/activity-tracker';
import { SearchableItem, SearchItemType } from '../src/core/types';
import { benchmark } from './utils';

/**
 * Benchmarks for ActivityTracker covering both record access performance
 * and I/O efficiency (async saving).
 */
export async function runActivityTrackerBenchmarks() {
    console.log('=== Activity Tracker Benchmarks ===');

    const TMP_DIR = path.join(os.tmpdir(), 'deeplens-activity-bench-' + Date.now());
    if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });

    let tracker: ActivityTracker | undefined;

    try {
        tracker = new ActivityTracker(TMP_DIR);
        const ITEM_COUNT = 5000;
        const items: SearchableItem[] = [];

        // Pre-populate items
        console.log(`Pre-populating ${ITEM_COUNT} items...`);
        for (let i = 0; i < ITEM_COUNT; i++) {
            const item: SearchableItem = {
                id: `file-${i}`,
                name: `File${i}.ts`,
                type: SearchItemType.FILE,
                filePath: `/src/File${i}.ts`,
            };
            items.push(item);
            // Record initial access to populate internal map
            tracker.recordAccess(item);
        }

        // 1. Benchmark single access performance
        await benchmark(
            `Record Access (N=${ITEM_COUNT})`,
            async () => {
                // Pick a random item to access
                const idx = Math.floor(Math.random() * ITEM_COUNT);
                tracker!.recordAccess(items[idx]);
            },
            50,
        );

        // 2. Measure I/O burst (specifically for async save functionality)
        console.log('Measuring I/O Burst (100 concurrent saveActivities)...');
        const ioStart = performance.now();
        const promises = [];
        for (let i = 0; i < 100; i++) {
            promises.push(tracker.saveActivities());
        }
        const ioEnd = performance.now();
        const blockingTime = (ioEnd - ioStart).toFixed(4);
        console.log(`Main Thread Blocking Time: ${blockingTime} ms (should be <1ms for async)`);

        await Promise.all(promises);
        console.log('All I/O operations completed.');
    } catch (e) {
        console.error('Benchmark error:', e);
    } finally {
        if (tracker) {
            tracker.dispose();
        }
        if (fs.existsSync(TMP_DIR)) {
            fs.rmSync(TMP_DIR, { recursive: true, force: true });
        }
    }
    console.log('\n');
}

// Auto-run if executed directly
if (import.meta.main || (typeof require !== 'undefined' && require.main === module)) {
    runActivityTrackerBenchmarks().catch(console.error);
}
