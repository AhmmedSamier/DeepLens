import * as path from 'path';
import * as fs from 'fs';
import { SearchEngine } from '../src/core/search-engine';
import { Config } from '../src/core/config';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runTextSearchBenchmarks() {
    console.log("=== Text Search Benchmarks ===");

    const engine = new SearchEngine();

    // Mock Config
    const config = {
        isTextSearchEnabled: () => true,
        getSearchConcurrency: () => 60,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        isRespectGitignoreEnabled: () => false
    } as unknown as Config;

    engine.setConfig(config);

    const tempDir = path.join(__dirname, 'temp_text_search');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const fileCount = 100;
    const items = [];

    // Create files
    for(let i=0; i<fileCount; i++) {
        const filePath = path.join(tempDir, `file_${i}.txt`);
        const content = `This is file number ${i}.\nIt contains some random text.\nHere is the magic keyword: UNICORN.\nMore text here.`;
        fs.writeFileSync(filePath, content);

        items.push({
            id: `file-${i}`,
            name: `file_${i}.txt`,
            type: SearchItemType.FILE,
            filePath: filePath,
            relativeFilePath: `temp_text_search/file_${i}.txt`,
            fullName: `file_${i}.txt`
        });
    }

    engine.setItems(items);

    try {
        await benchmark("Text Search 100 files", async () => {
            await engine.search({ query: "UNICORN", scope: SearchScope.TEXT });
        }, 10);
    } finally {
        // Cleanup
        for(let i=0; i<fileCount; i++) {
            fs.unlinkSync(path.join(tempDir, `file_${i}.txt`));
        }
        fs.rmdirSync(tempDir);
    }

    console.log("\n");
}
