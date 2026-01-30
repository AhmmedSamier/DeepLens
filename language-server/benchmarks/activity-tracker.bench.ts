import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ActivityTracker } from '../src/core/activity-tracker';
import { SearchableItem, SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runActivityTrackerBenchmark() {
    console.log("=== Activity Tracker Benchmarks ===");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-activity-bench-'));
    console.log(`Using temp dir: ${tempDir}`);

    const tracker = new ActivityTracker(tempDir);
    const ITEM_COUNT = 5000;
    const items: SearchableItem[] = [];

    // Pre-populate items
    console.log(`Pre-populating ${ITEM_COUNT} items...`);
    for (let i = 0; i < ITEM_COUNT; i++) {
        const item: SearchableItem = {
            id: `file-${i}`,
            name: `File${i}.ts`,
            type: SearchItemType.FILE,
            filePath: `/src/File${i}.ts`
        };
        items.push(item);
        // Record initial access to populate internal map
        tracker.recordAccess(item);
    }

    try {
        // Benchmark single access (which triggers recalculation + save)
        await benchmark(`Record Access (N=${ITEM_COUNT})`, async () => {
            // Pick a random item to access
            const idx = Math.floor(Math.random() * ITEM_COUNT);
            tracker.recordAccess(items[idx]);
        }, 50); // 50 iterations to average out

    } catch (e) {
        console.error("Benchmark failed:", e);
    } finally {
        tracker.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// Auto-run if executed directly
if (require.main === module) {
    runActivityTrackerBenchmark();
}
