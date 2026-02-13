
import { performance } from 'perf_hooks';
import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchableItem } from '../src/core/types';

export async function runPruneCacheBenchmarks() {
    console.log('--- Prune Cache Benchmark (Ref Counting) ---');
    const engine = new SearchEngine();
    const items: SearchableItem[] = [];

    // Create 50k unique items
    for (let i = 0; i < 50000; i++) {
        items.push({
            id: `item-${i}`,
            name: `FileNumber${i}.ts`,
            type: SearchItemType.FILE,
            filePath: `/src/FileNumber${i}.ts`,
            relativeFilePath: `src/FileNumber${i}.ts`,
            fullName: `src/FileNumber${i}.ts`,
        });
    }

    const startSetup = performance.now();
    engine.setItems(items);
    console.log(`Setup took ${(performance.now() - startSetup).toFixed(2)}ms`);

    // @ts-ignore
    const initialCacheSize = engine.preparedCache.size;
    console.log(`Initial Prepared cache size: ${initialCacheSize}`);

    // Remove 5k items one by one
    const startRemove = performance.now();
    for (let i = 0; i < 5000; i++) {
         engine.removeItemsByFile(`/src/FileNumber${i}.ts`);
    }
    const endRemove = performance.now();
    console.log(`Removing 5k items took ${(endRemove - startRemove).toFixed(2)}ms`);

    // Verify cache size immediately
    // @ts-ignore
    const finalCacheSize = engine.preparedCache.size;
    console.log(`Final Prepared cache size: ${finalCacheSize}`);
    console.log(`Cache entries removed: ${initialCacheSize - finalCacheSize}`);

    if (finalCacheSize < initialCacheSize) {
        console.log('SUCCESS: Cache size decreased immediately.');
    } else {
        console.log('FAILURE: Cache size did not decrease.');
    }
    console.log('');
}
