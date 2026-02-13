import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runConcurrencyBenchmarks() {
    console.log("=== Concurrency Benchmarks ===");

    const engine = new SearchEngine();
    const itemCount = 20000;
    const items: any[] = [];

    for (let i = 0; i < itemCount; i++) {
        items.push({
            id: `id-${i}`,
            name: `Item${i}`,
            type: SearchItemType.FILE,
            filePath: `/path/to/Item${i}.ts`,
            relativeFilePath: `Item${i}.ts`,
            fullName: `Item${i}`
        });
    }
    await engine.setItems(items);

    const concurrentRequests = 10;
    
    await benchmark(`${concurrentRequests} Concurrent Searches`, async () => {
        const promises: Promise<any>[] = [];
        for (let i = 0; i < concurrentRequests; i++) {
            promises.push(engine.search({ query: `Item${Math.floor(Math.random() * itemCount)}`, scope: SearchScope.EVERYTHING }));
        }
        await Promise.all(promises);
    }, 50);

    console.log("\n");
}

if (require.main === module) {
    runConcurrencyBenchmarks();
}
