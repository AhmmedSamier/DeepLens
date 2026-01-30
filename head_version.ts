import { ActivityTracker } from '../src/core/activity-tracker';
import * as fs from 'fs';
import * as path from 'path';

export async function runActivityTrackerBenchmarks() {
    console.log("=== Activity Tracker Benchmarks ===");

    const TMP_DIR = path.join(__dirname, 'tmp_bench_activity');
    if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });

    let tracker: ActivityTracker | undefined;

    try {
        tracker = new ActivityTracker(TMP_DIR);
        const itemCount = 1000;

        // Populate with data
        console.log(`Populating state with ${itemCount} items...`);
        for (let i = 0; i < itemCount; i++) {
             const item = {
                id: `file_${i}`,
                name: `file_${i}`,
                kind: 1,
                containerName: 'src',
                uri: `file:///src/file_${i}`,
                relativePath: `src/file_${i}`
            } as any;
            tracker.recordAccess(item);
        }
        console.log('State populated.');

        // Measure I/O burst
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
    console.log("\n");
}

if (import.meta.main) {
    runActivityTrackerBenchmarks();
}
