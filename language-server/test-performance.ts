import { SearchEngine } from "./src/core/search-engine";
import { SearchItemType } from "./src/core/types";

function benchmark() {
    const engine = new SearchEngine();

    // Add 10,000 files with 100 items per file
    const items = [];
    for (let i = 0; i < 1000000; i++) {
        const fileId = Math.floor(i / 100);
        items.push({
            id: `item-${i}`,
            name: `Item ${i}`,
            type: SearchItemType.CLASS,
            filePath: `/file-${fileId}.ts`,
            range: { start: { line: i, character: 0 }, end: { line: i, character: 10 } }
        });
    }

    engine.setItems(items);

    const start = performance.now();

    // Remove items by file
    for (let i = 0; i < 10000; i++) {
        engine.removeItemsByFile(`/file-${i}.ts`);
    }

    const end = performance.now();

    console.log(`Removal time for set based removal: ${end - start} ms`);
}

benchmark();
