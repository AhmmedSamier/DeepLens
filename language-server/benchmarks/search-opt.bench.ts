import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runSearchOptBenchmarks() {
    console.log("=== Search Optimization Benchmarks ===");

    const engine = new SearchEngine();
    const itemCount = 10000; // Increased count to see difference
    const items = [];

    // Create items that match "MC" via CamelHumps (MyClass...)
    for (let i = 0; i < itemCount; i++) {
        items.push({
            id: `id-${i}`,
            name: `MyClass${i}`,
            type: SearchItemType.CLASS,
            filePath: `/src/MyClass${i}.ts`,
            relativeFilePath: `src/MyClass${i}.ts`,
            fullName: `MyClass${i}`
        });
    }

    engine.setItems(items);

    // 1. "MC" -> Perfect CamelHumps match (MyClass). Should trigger optimization.
    await benchmark("CamelHumps 'MC' (Should be fast)", async () => {
        await engine.search({ query: "MC", scope: SearchScope.EVERYTHING });
    }, 50);

    // 2. "MyCl" -> Fuzzy match.
    await benchmark("Fuzzy 'MyCl' (Baseline)", async () => {
        await engine.search({ query: "MyCl", scope: SearchScope.EVERYTHING });
    }, 50);
}
