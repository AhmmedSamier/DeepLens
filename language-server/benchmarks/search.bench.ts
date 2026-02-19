import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runSearchBenchmarks() {
    console.log("=== Search Engine Benchmarks ===");

    const engine = new SearchEngine();
    const itemCount = 50000;

    const items: any[] = [];

    for (let i = 0; i < itemCount; i++) {
        items.push({
            id: `id-${i}`,
            name: `File${i}Component.ts`,
            type: SearchItemType.FILE,
            filePath: `/project/src/components/File${i}Component.ts`,
            relativeFilePath: `src/components/File${i}Component.ts`,
            fullName: `File${i}Component.ts`
        });

        items.push({
            id: `class-${i}`,
            name: `File${i}Component`,
            type: SearchItemType.CLASS,
            filePath: `/project/src/components/File${i}Component.ts`,
            relativeFilePath: `src/components/File${i}Component.ts`,
            fullName: `File${i}Component`
        });

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

    await engine.setItems(items);

    console.log(`Initialized engine with ${items.length} items.`);

    // Warmup
    await engine.search({ query: "warmup", scope: SearchScope.EVERYTHING });

    await benchmark("Fuzzy Search 'File100'", async () => {
        await engine.search({ query: "File100", scope: SearchScope.EVERYTHING });
    }, 100);

    await benchmark("Short query search 'FCC'", async () => {
        await engine.search({ query: "FCC", scope: SearchScope.EVERYTHING });
    }, 100);

    await benchmark("Non-matching Search 'Zebra'", async () => {
        await engine.search({ query: "Zebra", scope: SearchScope.EVERYTHING });
    }, 100);

    await benchmark("Path-only Match 'src'", async () => {
        await engine.search({ query: "src", scope: SearchScope.EVERYTHING });
    }, 100);

    await benchmark("Search 'Component' (Large result set)", async () => {
        await engine.search({ query: "Component", scope: SearchScope.EVERYTHING });
    }, 50);

    await benchmark("File Scope Search 'File100Component.ts'", async () => {
        await engine.search({ query: "File100Component.ts", scope: SearchScope.FILES });
    }, 100);

    await benchmark("Type Scope Search 'File100Component'", async () => {
        await engine.search({ query: "File100Component", scope: SearchScope.TYPES });
    }, 100);

    await benchmark("Method Scope Search 'calculateSomething100'", async () => {
        await engine.search({ query: "calculateSomething100", scope: SearchScope.SYMBOLS });
    }, 100);

    console.log("\n");
}

if (import.meta.main) {
    runSearchBenchmarks();
}
