import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchableItem } from '../src/core/types';
import { benchmark } from './utils';

export async function runSearchIngestionBenchmark() {
    console.log("=== Search Engine Ingestion Benchmark ===");

    const engine = new SearchEngine();
    const items: SearchableItem[] = [];
    const FILE_COUNT = 500;
    const ITEMS_PER_FILE = 20;
    const TOTAL_ITEMS = FILE_COUNT * ITEMS_PER_FILE;

    // Generate items: 10,000 items from 500 files (20 symbols per file)
    // This simulates a realistic codebase where files contain multiple symbols.
    for (let f = 0; f < FILE_COUNT; f++) {
        const filePath = `src/components/DeepLensButton_${f}.tsx`;
        // Windows style path for worst-case scenario (requires replacement)
        const relativePath = `src\\components\\DeepLensButton_${f}.tsx`;
        const containerName = `DeepLensButton_${f}`;

        // Add file item
        items.push({
            id: `file:${filePath}`,
            name: `DeepLensButton_${f}.tsx`,
            type: SearchItemType.FILE,
            filePath: filePath,
            relativeFilePath: relativePath,
            fullName: relativePath
        });

        // Add symbols
        for (let i = 0; i < ITEMS_PER_FILE; i++) {
            items.push({
                id: `symbol:${filePath}:method_${i}`,
                name: `handleClick_${i}`,
                type: SearchItemType.METHOD,
                filePath: filePath,
                relativeFilePath: relativePath, // Same relative path!
                containerName: containerName,
                fullName: `${containerName}.handleClick_${i}`
            });
        }
    }

    console.log(`Prepared ${items.length} items.`);

    try {
        await benchmark(`SearchEngine.setItems with ${items.length} items`, async () => {
            await engine.setItems(items);
        }, 5); // 5 iterations
    } catch (e) {
        console.error("Benchmark failed:", e);
    }
}

if (require.main === module) {
    runSearchIngestionBenchmark();
}
