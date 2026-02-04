/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import { SearchEngine } from './search-engine';
import { SymbolProvider } from './providers/symbol-provider';
import { SearchItemType, SearchScope, SearchableItem } from './types';

describe('SearchEngine', () => {
    const createTestItem = (id: string, name: string, type: SearchItemType, relativePath: string): SearchableItem => ({
        id,
        name,
        type,
        filePath: path.normalize(`/${relativePath}`),
        relativeFilePath: relativePath,
        fullName: name,
    });

    it('should find items by name', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
            createTestItem('2', 'UserService.cs', SearchItemType.FILE, 'src/UserService.cs'),
        ];
        engine.setItems(items);

        const results = await engine.search({
            query: 'Employee',
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
        engine.setItems(items);

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

    it('should handle filename:line pattern in burstSearch', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
        ];
        engine.setItems(items);

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
        engine.setItems(items);

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
        engine.setItems(items);

        engine.removeItemsByFile(path.normalize('/src/File1.ts'));

        expect(engine.getItemCount()).toBe(1);
        const results = await engine.search({ query: 'File', scope: SearchScope.EVERYTHING });
        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File2.ts');
    });

    it('should deduplicate prepared strings', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'CommonName', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('2', 'CommonName', SearchItemType.INTERFACE, 'src/File2.ts'),
        ];
        engine.setItems(items);

        // Access private members via casting to any
        const preparedNames = (engine as any).preparedNames;

        expect(preparedNames.length).toBe(2);
        // The objects should be referentially strictly equal
        expect(preparedNames[0]).toBe(preparedNames[1]);
    });

    it('should prune cache after removing items', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'UniqueName1', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('2', 'UniqueName2', SearchItemType.INTERFACE, 'src/File2.ts'),
            createTestItem('3', 'UniqueName3', SearchItemType.ENUM, 'src/File3.ts'),
        ];
        engine.setItems(items);

        const preparedCache = (engine as any).preparedCache as Map<string, any>;
        const initialCacheSize = preparedCache.size;
        expect(initialCacheSize).toBeGreaterThan(0);

        // Remove item 2
        engine.removeItemsByFile(path.normalize('/src/File2.ts'));

        // Verify cache size hasn't changed yet (lazy pruning)
        expect(preparedCache.size).toBe(initialCacheSize);

        // Manually trigger prune for testing
        (engine as any).pruneCache();

        // Verify cache size decreased
        expect(preparedCache.size).toBeLessThan(initialCacheSize);

        // Ensure UniqueName2 is gone
        expect(preparedCache.has('UniqueName2')).toBe(false);
        // Ensure others remain
        expect(preparedCache.has('UniqueName1')).toBe(true);
    });

    it('should preserve used items in low cache during pruning even when full', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [];

        // Add enough items to exceed the 20000 limit
        // We need 20001 unique names
        for (let i = 0; i < 20005; i++) {
            items.push(createTestItem(`${i}`, `Item${i}`, SearchItemType.CLASS, `src/File${i}.ts`));
        }

        engine.setItems(items);

        const preparedLowCache = (engine as any).preparedLowCache as Map<string, string>;

        // Verify cache is full
        expect(preparedLowCache.size).toBeGreaterThan(20000);

        // Trigger prune (simulate conditions)
        // Force prune even if removals haven't happened, but logic checks removedSinceLastPrune
        (engine as any).removedSinceLastPrune = 2001;

        // Trigger prune
        (engine as any).pruneCache();

        // With current implementation, size should be 0 because it wipes all
        // With FIX, it should be 20005

        // Expectation for the FIX:
        expect(preparedLowCache.size).toBeGreaterThan(20000);
        expect(preparedLowCache.has('Item0')).toBe(true);
    });

    it('should filter by OPEN scope', async () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'File1.ts', SearchItemType.FILE, 'src/File1.ts'),
            createTestItem('2', 'File2.ts', SearchItemType.FILE, 'src/File2.ts'),
        ];
        engine.setItems(items);
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
        engine.setItems([item]);
        engine.setActiveFiles([path.normalize('/src/File1.ts')]);

        const results = await engine.search({
            query: 'File1',
            scope: SearchScope.OPEN,
        });

        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('File1.ts');
    });

    it('should return symbols for OPEN scope when providers are registered', async () => {
        const engine = new SearchEngine();
        engine.registerProvider(new SymbolProvider(engine));
        const items: SearchableItem[] = [
            createTestItem('1', 'ClassOne', SearchItemType.CLASS, 'src/File1.ts'),
            createTestItem('2', 'ClassTwo', SearchItemType.CLASS, 'src/File2.ts'),
        ];
        engine.setItems(items);
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
        engine.setItems(items);

        // Mock GitProvider
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
});
