import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runSearchBenchmarks() {
    console.log("=== Search Engine Benchmarks ===");

    const engine = new SearchEngine();
    const itemCount = 5000;

    // Setup items
    const items = [];
    for (let i = 0; i < itemCount; i++) {
        items.push({
            id: `id-${i}`,
            name: `File${i}Component.ts`,
            type: SearchItemType.FILE,
            filePath: `/project/src/components/File${i}Component.ts`,
            relativeFilePath: `src/components/File${i}Component.ts`,
            fullName: `File${i}Component.ts`
        });

        // Add some methods
        if (i % 5 === 0) {
            items.push({
                id: `method-${i}`,
                name: `calculateSomething${i}`,
                type: SearchItemType.METHOD,
                filePath: `/project/src/components/File${i}Component.ts`,
                relativeFilePath: `src/components/File${i}Component.ts`,
                fullName: `File${i}Component.calculateSomething${i}`,
                containerName: `File${i}Component`
            });
        }
    }

    engine.setItems(items);
    console.log(`Initialized engine with ${items.length} items.`);

    await benchmark("Fuzzy Search 'File100'", async () => {
        await engine.search({ query: "File100", scope: SearchScope.EVERYTHING });
    }, 100);

    await benchmark("CamelHumps Search 'FCC'", async () => {
        await engine.search({ query: "FCC", scope: SearchScope.EVERYTHING });
    }, 100);

    await benchmark("Burst Search 'calc'", async () => {
        engine.burstSearch({ query: "calc", scope: SearchScope.SYMBOLS });
    }, 100);

    console.log("\n");
}
