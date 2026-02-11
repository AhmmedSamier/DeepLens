import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import { Config } from './config';
import { SearchEngine } from './search-engine';
import { SearchItemType, SearchScope } from './types';

describe('SearchEngine Performance', () => {
    it('should cache file size after fetching it in performStreamSearch', async () => {
        // Mock fs.promises.stat
        const statSpy = spyOn(fs.promises, 'stat').mockImplementation(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { size: 1024 } as any;
        });

        const engine = new SearchEngine();
        const config = new Config();
        // Assume default config enables text search
        engine.setConfig(config);

        // Create a file item WITHOUT size
        const fileItem = {
            id: 'file1',
            name: 'test.ts',
            type: SearchItemType.FILE,
            filePath: '/test.ts',
            relativeFilePath: 'test.ts'
        };

        engine.setItems([fileItem]);

        // First search: should call stat
        await engine.search({ query: 'foo', scope: SearchScope.TEXT });
        expect(statSpy).toHaveBeenCalledTimes(1);

        // Second search: should NOT call stat if cached
        await engine.search({ query: 'foo', scope: SearchScope.TEXT });

        // With optimization, it should remain 1.
        expect(statSpy).toHaveBeenCalledTimes(1);

        statSpy.mockRestore();
    });
});
