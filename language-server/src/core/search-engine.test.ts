/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { SymbolProvider } from './providers/symbol-provider';
import { SearchEngine, escapeRegExp } from './search-engine';
import { ISearchProvider, SearchItemType, SearchScope, SearchableItem } from './types';

const createTestItem = (id: string, name: string, type: SearchItemType, relativePath: string): SearchableItem => ({
    id,
    name,
    type,
    filePath: path.normalize(`/${relativePath}`),
    relativeFilePath: relativePath,
    fullName: name,
});

describe('escapeRegExp', () => {
    it('escapes canonical regex meta characters accurately', () => {
        expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('escapes adjacent metacharacters correctly', () => {
        expect(escapeRegExp('.*+?')).toBe('\\.\\*\\+\\?');
    });

    it('returns the same string for no-op inputs', () => {
        expect(escapeRegExp('abc123')).toBe('abc123');
        expect(escapeRegExp('')).toBe('');
    });
});

function createDelayedProvider(id: string, fileItem: SearchableItem): ISearchProvider {
    return {
        id,
        priority: 1,
        search: async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return [
                {
                    item: fileItem,
                    score: id === 'p1' ? 1 : 0.9,
                    scope: SearchScope.FILES,
                },
            ];
        },
    };
}

describe('SearchEngine', () => {
    it('should find items by name', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
            createTestItem('2', 'UserService.cs', SearchItemType.FILE, 'src/UserService.cs'),
        ];
        await engine.setItems(items);

        const results = await engine.search({
            query: 'Employee',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.name).toBe('EmployeeService.cs');
    });

    it('should find EmployeeService when typing empserv (US1 regression)', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
        ];
        await engine.setItems(items);

        const results = await engine.search({
            query: 'empserv',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.name).toBe('EmployeeService.cs');
    });

    it('should handle filename:line pattern', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
            createTestItem('2', 'EmployeeService', SearchItemType.CLASS, 'src/EmployeeService.cs'),
        ];
        await engine.setItems(items);

        const results = await engine.search({
            query: 'EmployeeService:200',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.line).toBe(199); // 0-indexed

        // Should also work for the class match
        const classMatch = results.find((r) => r.item.type === SearchItemType.CLASS);
        if (classMatch) {
            expect(classMatch.item.line).toBe(199);
        }
    });

    it('should handle filename:line pattern in burstSearch', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
        ];
        await engine.setItems(items);

        const results = await engine.burstSearch({
            query: 'EmployeeService:50',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.name).toBe('EmployeeService.cs');
        expect(results[0].item.line).toBe(49);
    });

    it('should not break on simple search without line number', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
        ];
        await engine.setItems(items);

        const results = await engine.search({
            query: 'EmployeeService',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.line).toBeUndefined();
    });

    it('should remove items by file correctly', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts'),
            createTestItem('2', 'Class1', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('3', 'File2.ts', SearchItemType.FILE, 'src/File2.ts'),
        ];
        await engine.setItems(items);

        engine.removeItemsByFile(path.normalize('/src/File1.ts'));

        expect(engine.getItemCount()).toBe(1);
        const results = await engine.search({ query: 'File', scope: SearchScope.EVERYTHING });
        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File2.ts');
    });

    it('should deduplicate prepared strings', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'CommonName', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('2', 'CommonName', SearchItemType.INTERFACE, 'src/File2.ts'),
        ];
        await engine.setItems(items);

        // Access private members via casting to any
        const preparedNames = (engine as any).preparedNames;

        expect(preparedNames.length).toBe(2);
        // The objects should be referentially strictly equal
        expect(preparedNames[0]).toBe(preparedNames[1]);
    });

    it('should prune cache immediately after removing items', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'UniqueName1', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('2', 'UniqueName2', SearchItemType.INTERFACE, 'src/File2.ts'),
            createTestItem('3', 'UniqueName3', SearchItemType.ENUM, 'src/File3.ts'),
        ];
        await engine.setItems(items);

        const preparedCache = (engine as any).preparedCache as Map<string, any>;
        const initialCacheSize = preparedCache.size;
        expect(initialCacheSize).toBeGreaterThan(0);

        // Remove item 2
        engine.removeItemsByFile(path.normalize('/src/File2.ts'));

        // Verify cache size decreased immediately (ref counting)
        expect(preparedCache.size).toBeLessThan(initialCacheSize);

        // Ensure UniqueName2 is gone
        expect(preparedCache.has('UniqueName2')).toBe(false);
        // Ensure others remain
        expect(preparedCache.has('UniqueName1')).toBe(true);
    });

    it('should filter by OPEN scope', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts'),
            createTestItem('2', 'File2.ts', SearchItemType.FILE, 'src/File2.ts'),
        ];
        await engine.setItems(items);
        engine.setActiveFiles([path.normalize('/src/File1.ts')]);

        const results = await engine.search({
            query: 'File',
            scope: SearchScope.OPEN,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File1.ts');
    });

    it('should match OPEN scope when file paths need normalization', async () => {
        const engine = new SearchEngine();
        const item: SearchableItem = {
            id: '1',
            name: 'File1.ts',
            type: SearchItemType.FILE,
            filePath: '/src/dir/../File1.ts',
            relativeFilePath: 'src/File1.ts',
            fullName: 'File1.ts',
        };
        await engine.setItems([item]);
        engine.setActiveFiles([path.normalize('/src/File1.ts')]);

        const results = await engine.search({
            query: 'File1',
            scope: SearchScope.OPEN,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File1.ts');
    });
});

describe('SearchEngine FILE type boost ranking', () => {
    it('should apply 0.9 boost to FILE type items', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'MyComponent', SearchItemType.FILE, 'src/MyComponent.ts'),
            createTestItem('2', 'MyComponent', SearchItemType.CLASS, 'src/MyComponent.ts'),
        ];
        await engine.setItems(items);

        const results = await engine.search({
            query: 'MyComponent',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBe(2);
        // CLASS should rank higher than FILE due to boost (1.5 vs 0.9)
        expect(results[0].item.type).toBe(SearchItemType.CLASS);
        expect(results[1].item.type).toBe(SearchItemType.FILE);
        // Verify the FILE item has lower score due to 0.9 boost
        expect(results[1].score).toBeLessThan(results[0].score);
    });

    it('file boost 0.9 ranking - exact match FILE vs substring match CLASS', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'user', SearchItemType.FILE, 'src/user.ts'),
            createTestItem('2', 'userService', SearchItemType.CLASS, 'src/userService.ts'),
        ];
        await engine.setItems(items);

        const results = await engine.search({
            query: 'user',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBe(2);
        // Even with exact match, FILE type (0.9 boost) should rank below CLASS type (1.5 boost)
        // because the base fuzzy scores are similar and type boost dominates
        const fileResult = results.find((r) => r.item.type === SearchItemType.FILE);
        const classResult = results.find((r) => r.item.type === SearchItemType.CLASS);
        expect(fileResult).toBeDefined();
        expect(classResult).toBeDefined();
        expect(fileResult!.score).toBeLessThan(classResult!.score);
    });

    it('should rank FILE items lower than symbols with same base score in burstSearch', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'TestFile', SearchItemType.FILE, 'src/TestFile.ts'),
            createTestItem('2', 'TestFile', SearchItemType.FUNCTION, 'src/TestFile.ts'),
            createTestItem('3', 'TestFile', SearchItemType.VARIABLE, 'src/TestFile.ts'),
        ];
        await engine.setItems(items);

        const results = await engine.burstSearch({
            query: 'TestFile',
            scope: SearchScope.EVERYTHING,
            maxResults: 10,
        });

        expect(results.length).toBe(3);
        // FUNCTION (1.25 boost) > VARIABLE (1.0 boost) > FILE (0.9 boost)
        expect(results[0].item.type).toBe(SearchItemType.FUNCTION);
        expect(results[1].item.type).toBe(SearchItemType.VARIABLE);
        expect(results[2].item.type).toBe(SearchItemType.FILE);
    });

    it('should apply consistent FILE boost across different search scopes', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'config', SearchItemType.FILE, 'src/config.ts'),
            createTestItem('2', 'config', SearchItemType.VARIABLE, 'src/config.ts'),
        ];
        await engine.setItems(items);

        // Test regular search
        const regularResults = await engine.search({
            query: 'config',
            scope: SearchScope.EVERYTHING,
        });

        // Test burst search
        const burstResults = await engine.burstSearch({
            query: 'config',
            scope: SearchScope.EVERYTHING,
        });

        // In both cases, VARIABLE should rank higher than FILE
        expect(regularResults[0].item.type).toBe(SearchItemType.VARIABLE);
        expect(burstResults[0].item.type).toBe(SearchItemType.VARIABLE);
    });
});

describe('SearchEngine scopes and providers', () => {
    it('should return symbols for OPEN scope when providers are registered', async () => {
        const engine = new SearchEngine();
        engine.registerProvider(new SymbolProvider(engine));
        const items: SearchableItem[] = [
            createTestItem('1', 'ClassOne', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('2', 'ClassTwo', SearchItemType.CLASS, 'src/File2.ts'),
        ];
        await engine.setItems(items);
        engine.setActiveFiles([path.normalize('/src/File1.ts')]);

        const results = await engine.search({
            query: 'Class',
            scope: SearchScope.OPEN,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('ClassOne');
    });

    it('should filter by MODIFIED scope', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts'),
            createTestItem('2', 'File2.ts', SearchItemType.FILE, 'src/File2.ts'),
        ];
        await engine.setItems(items);

        const mockGitProvider = {
            getModifiedFiles: async () => {
                const filePath = path.normalize('/src/File2.ts');
                return new Set([process.platform === 'win32' ? filePath.toLowerCase() : filePath]);
            },
        };

        (engine as any).gitProvider = mockGitProvider;

        const results = await engine.search({
            query: 'File',
            scope: SearchScope.MODIFIED,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File2.ts');
    });

    it('should cache modified scope indices for a short TTL', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts'),
            createTestItem('2', 'File2.ts', SearchItemType.FILE, 'src/File2.ts'),
        ];
        await engine.setItems(items);

        let callCount = 0;
        const mockGitProvider = {
            getModifiedFiles: async () => {
                callCount++;
                const filePath = path.normalize('/src/File2.ts');
                return new Set([process.platform === 'win32' ? filePath.toLowerCase() : filePath]);
            },
        };
        (engine as any).gitProvider = mockGitProvider;

        await engine.search({ query: 'File', scope: SearchScope.MODIFIED });
        await engine.search({ query: 'File', scope: SearchScope.MODIFIED });

        expect(callCount).toBe(1);
    });

    it('should handle MODIFIED scope in burstSearch', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts'),
            createTestItem('2', 'File2.ts', SearchItemType.FILE, 'src/File2.ts'),
        ];
        engine.setItems(items);

        const mockGitProvider = {
            getModifiedFiles: async () => {
                const filePath = path.normalize('/src/File2.ts');
                return new Set([process.platform === 'win32' ? filePath.toLowerCase() : filePath]);
            },
        };

        (engine as any).gitProvider = mockGitProvider;

        const results = await engine.burstSearch({
            query: 'File',
            scope: SearchScope.MODIFIED,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File2.ts');
    });

    it('should execute providers concurrently', async () => {
        const engine = new SearchEngine();
        const fileItem = createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts');
        await engine.setItems([fileItem]);

        engine.registerProvider(createDelayedProvider('p1', fileItem));
        engine.registerProvider(createDelayedProvider('p2', fileItem));

        const start = Date.now();
        const results = await engine.search({ query: 'File', scope: SearchScope.EVERYTHING, maxResults: 10 });
        const durationMs = Date.now() - start;

        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(durationMs).toBeLessThan(75);
    });
});
