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

    it('should find items by name', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
            createTestItem('2', 'UserService.cs', SearchItemType.FILE, 'src/UserService.cs'),
        ];
        engine.setItems(items);

        const results = engine.search({
            query: 'Employee',
            scope: SearchScope.EVERYTHING
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.name).toBe('EmployeeService.cs');
    });

    it('should handle filename:line pattern', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
            createTestItem('2', 'EmployeeService', SearchItemType.CLASS, 'src/EmployeeService.cs'),
        ];
        engine.setItems(items);

        const results = engine.search({
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

    it('should not break on simple search without line number', () => {
        const engine = new SearchEngine();
        const items: SearchableItem[] = [
            createTestItem('1', 'EmployeeService.cs', SearchItemType.FILE, 'src/EmployeeService.cs'),
        ];
        engine.setItems(items);

        const results = engine.search({
            query: 'EmployeeService',
            scope: SearchScope.EVERYTHING
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].item.line).toBeUndefined();
    });
});
