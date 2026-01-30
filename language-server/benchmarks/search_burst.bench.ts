import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark, saveBenchmarks } from './utils';
import * as path from 'path';

async function runBurstBenchmark() {
    console.log("=== Burst Search Benchmarks ===");

    const engine = new SearchEngine();

    // Generate 50,000 items
    const ITEM_COUNT = 50000;
    const items = [];

    // Create diverse items to fill arrays
    for (let i = 0; i < ITEM_COUNT; i++) {
        // 10% match 'App' prefix
        // 10% match 'User' prefix
        // Rest match random stuff
        let name;
        if (i < ITEM_COUNT * 0.1) {
            name = `AppController${i}`;
        } else if (i < ITEM_COUNT * 0.2) {
            name = `UserHelper${i}`;
        } else {
            name = `Service${i}Generator`;
        }

        items.push({
            id: `id-${i}`,
            name: name,
            type: i % 2 === 0 ? SearchItemType.CLASS : SearchItemType.FILE,
            filePath: `/src/file${i}.ts`,
            relativeFilePath: `src/file${i}.ts`,
            fullName: name
        });
    }

    engine.setItems(items);
    console.log(`Initialized engine with ${items.length} items.`);

    // Warmup
    engine.burstSearch({ query: 'App', scope: SearchScope.EVERYTHING, maxResults: 10 });

    // Benchmark 1: Match some items (prefix 'App') - Early exit usually
    // But burstSearch continues until maxResults.
    await benchmark('Burst Search "App" (Matches found)', () => {
        engine.burstSearch({ query: 'app', scope: SearchScope.EVERYTHING, maxResults: 50 });
    }, 100);

    // Benchmark 2: Match NO items (Worst case scan)
    await benchmark('Burst Search "Zzz" (No match)', () => {
        engine.burstSearch({ query: 'zzz', scope: SearchScope.EVERYTHING, maxResults: 50 });
    }, 100);

    // Benchmark 3: Short prefix "S" (Many matches, fills results quickly)
    await benchmark('Burst Search "S" (Many matches)', () => {
        engine.burstSearch({ query: 's', scope: SearchScope.EVERYTHING, maxResults: 50 });
    }, 100);

    saveBenchmarks(path.join(__dirname, 'results_burst.json'));
}

if (require.main === module) {
    runBurstBenchmark();
}
