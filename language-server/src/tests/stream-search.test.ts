import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config } from '../core/config';
import { SearchEngine } from '../core/search-engine';
import { SearchItemType, SearchScope, SearchableItem } from '../core/types';

describe('SearchEngine Stream Search', () => {
    let tempDir: string;
    let filePath: string;
    let engine: SearchEngine;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-test-'));
        filePath = path.join(tempDir, 'test-file.ts');
        // Create file with indentation
        // 4 spaces indentation
        // "    const foo = 1;"
        // Indices:
        // 0123 (spaces)
        // 456789 (const )
        // 10 (f)
        const content = '    const foo = 1;';
        fs.writeFileSync(filePath, content);

        engine = new SearchEngine();
        // Enable text search via config mock?
        // SearchEngine checks config.isTextSearchEnabled().
        // If config is undefined, it might skip text search or default?
        // check code: "if (scope === SearchScope.TEXT && this.config?.isTextSearchEnabled())"
        // I need to mock config.

        const mockConfig = {
            isTextSearchEnabled: () => true,
            getSearchConcurrency: () => 1,
        } as Config;
        engine.setConfig(mockConfig);
    });

    afterAll(() => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
        }
    });

    it('should return correct highlights relative to trimmed line for indented text', async () => {
        const item: SearchableItem = {
            id: '1',
            name: 'test-file.ts',
            type: SearchItemType.FILE,
            filePath: filePath,
            relativeFilePath: 'test-file.ts',
        };
        engine.setItems([item]);

        const results = await engine.search({
            query: 'foo',
            scope: SearchScope.TEXT,
            maxResults: 10,
        });

        expect(results.length).toBe(1);
        const result = results[0];

        // Check trimmed name
        expect(result.item.name).toBe('const foo = 1;');

        // Check absolute column (should be 10)
        expect(result.item.column).toBe(10);

        // Check highlights (should be relative to trimmed name: 6)
        // "const " is length 6. So foo starts at 6.
        expect(result.highlights).toBeDefined();
        expect(result.highlights![0]).toEqual([6, 9]);
    });
});
