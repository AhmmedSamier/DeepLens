import { describe, expect, it } from 'bun:test';
import { SearchEngine } from './search-engine';
import { SearchItemType, SearchScope, SearchableItem } from './types';

describe('SearchEngine', () => {
    const createTestItem = (id: string, name: string, type: SearchItemType, relativePath: string): SearchableItem => ({
        id,
        name,
        type,
        filePath: `/${relativePath}`,
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
            scope: SearchScope.EVERYTHING
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
            scope: SearchScope.EVERYTHING
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.line).toBe(199); // 0-indexed

        // Should also work for the class match
        const classMatch = results.find(r => r.item.type === SearchItemType.CLASS);
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
            scope: SearchScope.EVERYTHING
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
            scope: SearchScope.EVERYTHING
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

        engine.removeItemsByFile('/src/File1.ts');

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
});
