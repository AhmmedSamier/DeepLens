import { benchmark } from './utils';
import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchableItem } from '../src/core/types';

export async function runPruneCacheBenchmarks() {
    console.log('--- Prune Cache Benchmark (Ref Counting) ---');
    const engine = new SearchEngine();
    const items: SearchableItem[] = [];

    // Create 20k unique items
    for (let i = 0; i < 20000; i++) {
        items.push({
            id: `item-${i}`,
            name: `FileNumber${i}.ts`,
            type: SearchItemType.FILE,
            filePath: `/src/FileNumber${i}.ts`,
            relativeFilePath: `src/FileNumber${i}.ts`,
            fullName: `src/FileNumber${i}.ts`,
        });
    }

    await engine.setItems(items);

    const filesToRemove: string[] = [];
    for (let i = 0; i < 1000; i++) {
        filesToRemove.push(`/src/FileNumber${i}.ts`);
    }

    await benchmark(
        'Remove 1000 items (Incremental Pruning)',
        async () => {
            engine.removeItemsByFiles(filesToRemove);
        },
        1,
    );

    console.log('');
}
