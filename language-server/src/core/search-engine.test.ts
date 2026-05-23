/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeAll } from 'bun:test';
import * as path from 'node:path';
import { SymbolProvider } from './providers/symbol-provider';
import { SearchEngine, escapeRegExp } from './search-engine';
import { ISearchProvider, SearchItemType, SearchScope, SearchableItem } from './types';
import { mockIndex } from '../tests/mock-index';

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

    it('escapes interspersed metacharacters and alphanumerics correctly', () => {
        expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
        expect(escapeRegExp('test(123)')).toBe('test\\(123\\)');
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
        const results = await engine.search({
            query: 'File',
            scope: SearchScope.EVERYTHING,
            maxResults: 10,
        });
        const durationMs = Date.now() - start;

        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(durationMs).toBeLessThan(75);
    });
});

describe('SearchEngine incremental update deduplication', () => {
    it('should not add duplicate paths to filePaths when the same file item is added twice', async () => {
        const engine = new SearchEngine();
        const fileItem = createTestItem('file:src/Foo.ts', 'Foo.ts', SearchItemType.FILE, 'src/Foo.ts');

        await engine.addItems([fileItem]);
        await engine.addItems([fileItem]);

        const filePaths: string[] = (engine as any).filePaths;
        const uniquePaths = new Set(filePaths.map((p) => path.normalize(p)));
        expect(uniquePaths.size).toBe(filePaths.length);
        // Should only have one path for this file
        const matchingPaths = filePaths.filter((p) => p === fileItem.filePath);
        expect(matchingPaths.length).toBe(1);
    });

    it('should have correct filePaths after remove-then-add (simulating file change)', async () => {
        const engine = new SearchEngine();
        const fileItem = createTestItem('file:src/Bar.ts', 'Bar.ts', SearchItemType.FILE, 'src/Bar.ts');
        const symbol = createTestItem('sym:src/Bar.ts:MyClass', 'MyClass', SearchItemType.CLASS, 'src/Bar.ts');

        // Initial indexing
        await engine.addItems([fileItem, symbol]);
        expect(engine.getItemCount()).toBe(2);

        // Simulate file change: remove old items, then add new items
        engine.removeItemsByFile(fileItem.filePath);
        expect(engine.getItemCount()).toBe(0);

        const newFileItem = createTestItem('file:src/Bar.ts', 'Bar.ts', SearchItemType.FILE, 'src/Bar.ts');
        const newSymbol = createTestItem('sym:src/Bar.ts:MyClass', 'MyClass', SearchItemType.CLASS, 'src/Bar.ts');
        await engine.addItems([newFileItem, newSymbol]);

        expect(engine.getItemCount()).toBe(2);

        // filePaths should contain exactly one path for Bar.ts
        const filePaths: string[] = (engine as any).filePaths;
        expect(filePaths.filter((p) => p === newFileItem.filePath).length).toBe(1);
    });

    it('should produce no duplicate results after out-of-order add-then-remove (race condition simulation)', async () => {
        const engine = new SearchEngine();
        const fileItem = createTestItem('file:src/Race.ts', 'Race.ts', SearchItemType.FILE, 'src/Race.ts');
        const symbol = createTestItem('sym:src/Race.ts:RaceClass', 'RaceClass', SearchItemType.CLASS, 'src/Race.ts');

        // Initial indexing
        await engine.addItems([fileItem, symbol]);

        // Simulate race: add new items BEFORE removing old ones (this is the bug scenario)
        const newFileItem = createTestItem('file:src/Race.ts', 'Race.ts', SearchItemType.FILE, 'src/Race.ts');
        const newSymbol = createTestItem('sym:src/Race.ts:RaceClass', 'RaceClass', SearchItemType.CLASS, 'src/Race.ts');
        await engine.addItems([newFileItem, newSymbol]);

        // Now remove (the delayed removal fires)
        engine.removeItemsByFile(fileItem.filePath);

        // After everything settles, filePaths should NOT contain the file path
        // because the removal should have cleaned up all traces
        const filePaths: string[] = (engine as any).filePaths;
        expect(filePaths.filter((p) => p === fileItem.filePath).length).toBe(0);
    });
});

describe('RealIndexSearch', () => {
    it('should find 3 EmployeeService classes with lowercase query (backend, frontend, admin)', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.search({
            query: 'employeeservice',
            scope: SearchScope.EVERYTHING,
            maxResults: 50,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );

        expect(esClasses.length).toBe(3);

        const paths = esClasses.map((r) => r.item.filePath);
        expect(paths.some((p) => p.includes('BackEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('FrontEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('admin'))).toBe(true);
    });

    it('should find 3 EmployeeService classes with title-case query (backend, frontend, admin)', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.search({
            query: 'EmployeeService',
            scope: SearchScope.EVERYTHING,
            maxResults: 50,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );

        expect(esClasses.length).toBe(3);

        const paths = esClasses.map((r) => r.item.filePath);
        expect(paths.some((p) => p.includes('BackEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('FrontEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('admin'))).toBe(true);
    });

    it('search with maxResults=30 should still find all 3 EmployeeService classes', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.search({
            query: 'employeeservice',
            scope: SearchScope.EVERYTHING,
            maxResults: 30,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );
        expect(esClasses.length).toBe(3);
    });

    it('burstSearch with maxResults=30 should still find all 3 EmployeeService classes', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.burstSearch({
            query: 'employeeservice',
            scope: SearchScope.EVERYTHING,
            maxResults: 30,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );
        expect(esClasses.length).toBe(3);
    });

    it('burstSearch with maxResults=10 should still find all 3 EmployeeService classes', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.burstSearch({
            query: 'employeeservice',
            scope: SearchScope.EVERYTHING,
            maxResults: 10,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );
        expect(esClasses.length).toBe(3);
    });

    it('should find all 3 EmployeeService classes in TYPES scope', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.search({
            query: 'employeeservice',
            scope: SearchScope.TYPES,
            maxResults: 50,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );
        expect(esClasses.length).toBe(3);

        const paths = esClasses.map((r) => r.item.filePath);
        expect(paths.some((p) => p.includes('BackEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('FrontEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('admin'))).toBe(true);
    });

    it('should find all 3 EmployeeService classes in TYPES scope via burstSearch', async () => {
        const engine = new SearchEngine();
        await engine.setItems(mockIndex.items);

        const results = await engine.burstSearch({
            query: 'employeeservice',
            scope: SearchScope.TYPES,
            maxResults: 50,
        });

        const esClasses = results.filter(
            (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
        );
        expect(esClasses.length).toBe(3);

        const paths = esClasses.map((r) => r.item.filePath);
        expect(paths.some((p) => p.includes('BackEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('FrontEnd'))).toBe(true);
        expect(paths.some((p) => p.includes('admin'))).toBe(true);
    });

    describe('VS Code extension integration simulation', () => {
        // Simulates the exact search sequence the VS Code QuickPick uses:
        //   1. Instant burst (maxResults=10) — aims to populate quickly
        //   2. Scheduled burst (maxResults=30) — fills up with more results
        //   3. Full search (maxResults=100) — final comprehensive pass
        // This reproduces the flow that search-provider.ts runs.
        it('should return all 3 EmployeeService classes in EVERYTHING scope through all phases', async () => {
            const engine = new SearchEngine();
            await engine.setItems(mockIndex.items);

            // Phase 1: Instant burst (maxResults=10)
            const burst10 = await engine.burstSearch({
                query: 'employeeservice',
                scope: SearchScope.EVERYTHING,
                maxResults: 10,
            });
            expect(
                burst10.filter((r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService').length,
            ).toBe(3);

            // Phase 2: Scheduled burst (maxResults=30)
            const burst30 = await engine.burstSearch({
                query: 'employeeservice',
                scope: SearchScope.EVERYTHING,
                maxResults: 30,
            });
            expect(
                burst30.filter((r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService').length,
            ).toBe(3);

            // Phase 3: Full fuzzy search (maxResults=100)
            const full = await engine.search({
                query: 'employeeservice',
                scope: SearchScope.EVERYTHING,
                maxResults: 100,
            });
            expect(
                full.filter((r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService').length,
            ).toBe(3);
        });

        it('should return all 3 EmployeeService classes in TYPES scope through all phases', async () => {
            const engine = new SearchEngine();
            await engine.setItems(mockIndex.items);

            // Phase 1: Instant burst (maxResults=10, TYPES scope)
            const burst10 = await engine.burstSearch({
                query: 'employeeservice',
                scope: SearchScope.TYPES,
                maxResults: 10,
            });
            const burst10Classes = burst10.filter(
                (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
            );
            expect(burst10Classes.length).toBe(3);

            // Phase 2: Scheduled burst (maxResults=30, TYPES scope)
            const burst30 = await engine.burstSearch({
                query: 'employeeservice',
                scope: SearchScope.TYPES,
                maxResults: 30,
            });
            const burst30Classes = burst30.filter(
                (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
            );
            expect(burst30Classes.length).toBe(3);

            // Phase 3: Full fuzzy search (maxResults=100, TYPES scope)
            const full = await engine.search({
                query: 'employeeservice',
                scope: SearchScope.TYPES,
                maxResults: 100,
            });
            const fullClasses = full.filter(
                (r) => r.item.type === SearchItemType.CLASS && r.item.name === 'EmployeeService',
            );
            expect(fullClasses.length).toBe(3);

            // Verify the exact 3 classes are correct across all phases
            const backEndPath = (c: { item: { filePath: string } }) => c.item.filePath.includes('BackEnd');
            const frontEndPath = (c: { item: { filePath: string } }) => c.item.filePath.includes('FrontEnd');
            const adminPath = (c: { item: { filePath: string } }) => c.item.filePath.includes('admin');

            for (const classes of [burst10Classes, burst30Classes, fullClasses]) {
                expect(classes.some(backEndPath)).toBe(true);
                expect(classes.some(frontEndPath)).toBe(true);
                expect(classes.some(adminPath)).toBe(true);
            }
        });
    });
});
