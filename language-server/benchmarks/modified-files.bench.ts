import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

// Mock GitProvider
class MockGitProvider {
    private modifiedFiles: Set<string>;

    constructor(modifiedFiles: string[]) {
        this.modifiedFiles = new Set(modifiedFiles);
    }

    async getModifiedFiles(): Promise<Set<string>> {
        return this.modifiedFiles;
    }
}

export async function runModifiedFilesBenchmark() {
    console.log("=== Modified Files Search Benchmark ===");

    const engine = new SearchEngine();
    const itemCount = 50000;
    const modifiedCount = 100;

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
    }

    engine.setItems(items);
    console.log(`Initialized engine with ${items.length} items.`);

    // Setup Mock GitProvider with modified files
    // We pick files distributed across the index
    const modifiedFiles = [];
    for (let i = 0; i < modifiedCount; i++) {
        // Pick every 500th file to be modified
        const index = i * 500;
        if (index < items.length) {
            modifiedFiles.push(items[index].filePath); // Use normalized path logic if needed, but here simple match
        }
    }

    // Inject mock provider
    const mockGitProvider = new MockGitProvider(modifiedFiles);
    (engine as any).gitProvider = mockGitProvider;

    // We can't easily isolate getIndicesForModifiedFiles because it is private.
    // However, we can use 'any' cast to access it for benchmarking purposes,
    // or we can run a search with SearchScope.MODIFIED.
    // Running search includes performUnifiedSearch overhead, but since we have 100 items,
    // the dominant factor for O(N) getIndices vs O(M) getIndices should be visible.
    //
    // To be precise, let's measure getIndicesForModifiedFiles directly via cast.

    await benchmark("getIndicesForModifiedFiles (50k items, 100 modified)", async () => {
        await (engine as any).getIndicesForModifiedFiles();
    }, 100);

    console.log("\n");
}
