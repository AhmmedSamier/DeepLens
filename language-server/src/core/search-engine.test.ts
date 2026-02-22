/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { SymbolProvider } from './providers/symbol-provider';
import { SearchEngine } from './search-engine';
import { ISearchProvider } from './types';
import { SearchItemType, SearchScope, SearchableItem } from './types';

const createTestItem = (id: string, name: string, type: SearchItemType, relativePath: string): SearchableItem => ({
    id,
    name,
    type,
    filePath: path.normalize(`/${relativePath}`),
    relativeFilePath: relativePath,
    fullName: name,
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

        const results = engine.burstSearch({
            query: 'EmployeeService:50',
            scope: SearchScope.EVERYTHING,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.name).toBe('EmployeeService.cs');
        expect(results[0].item.line).toBe(49); // 0-indexed
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
