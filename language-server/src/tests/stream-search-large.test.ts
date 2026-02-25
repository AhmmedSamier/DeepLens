
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config } from '../core/config';
import { SearchEngine } from '../core/search-engine';
import { SearchItemType, SearchScope, SearchableItem } from '../core/types';

describe('SearchEngine Stream Search Large', () => {
    let tempDir: string;
    let filePath: string;
    let engine: SearchEngine;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-test-large-'));
        filePath = path.join(tempDir, 'large-test-file.ts');

        // Create a large file > 50KB to trigger stream path
        let content = '';
        for(let i=0; i<5000; i++) {
            content += `line ${i}: nothing here\n`;
        }
        content += `line 5000: TARGET_KEYWORD here\n`;
        for(let i=5001; i<10000; i++) {
            content += `line ${i}: nothing here\n`;
        }

        fs.writeFileSync(filePath, content);

        const stats = fs.statSync(filePath);
        // Ensure it's large enough (> 50KB)
        if (stats.size < 50 * 1024) {
             throw new Error('Test file too small for stream test');
        }

        engine = new SearchEngine();

        const mockConfig = {
            isTextSearchEnabled: () => true,
            getSearchConcurrency: () => 1,
        } as unknown as Config;
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

    it('should find match in large file using stream', async () => {
        const item: SearchableItem = {
            id: '1',
            name: 'large-test-file.ts',
            type: SearchItemType.FILE,
            filePath: filePath,
            relativeFilePath: 'large-test-file.ts',
        };
        engine.setItems([item]);
        // Force file size to be large in item cache?
        // scanFileStream checks fs.stat if size undefined.

        const results = await engine.search({
            query: 'TARGET_KEYWORD',
            scope: SearchScope.TEXT,
            maxResults: 10,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toContain('TARGET_KEYWORD');
        expect(results[0].item.line).toBe(5000);
    });

    it('should find multiple matches spanning chunks', async () => {
        // Overwrite with many matches
        let content = '';
        const expectedLines = [];
        for(let i=0; i<10000; i++) {
            if (i % 100 === 0) {
                content += `line ${i}: MATCH_KEYWORD\n`;
                expectedLines.push(i);
            } else {
                content += `line ${i}: nothing\n`;
            }
        }
        fs.writeFileSync(filePath, content);

        const item: SearchableItem = {
            id: '1',
            name: 'large-test-file.ts',
            type: SearchItemType.FILE,
            filePath: filePath,
            relativeFilePath: 'large-test-file.ts',
        };
        // Reset items to clear any cache
        engine.setItems([item]);

        const results = await engine.search({
            query: 'MATCH_KEYWORD',
            scope: SearchScope.TEXT,
            maxResults: 1000,
        });

        expect(results.length).toBe(expectedLines.length);
        expect(results.map(r => r.item.line).sort((a,b)=>a-b)).toEqual(expectedLines);
    });
});
