import { describe, expect, it } from 'bun:test';
import { RouteMatcher } from './route-matcher';

describe('RouteMatcher', () => {
    it('should match exact paths', () => {
        expect(RouteMatcher.isMatch('api/customers', 'api/customers')).toBe(true);
        expect(RouteMatcher.isMatch('/api/customers/', 'api/customers')).toBe(true);
    });

    it('should match parameterized paths', () => {
        expect(RouteMatcher.isMatch('api/customers/{id}', 'api/customers/5')).toBe(true);
        expect(RouteMatcher.isMatch('api/customers/{id}', 'api/customers/abc')).toBe(true);
        expect(
            RouteMatcher.isMatch('api/AdminDashboard/customers/{customerId}', 'api/AdminDashboard/customers/5'),
        ).toBe(true);
        expect(
            RouteMatcher.isMatch('api/AdminDashboard/customers/{id}', 'api/AdminDashboard/customers/50'),
        ).toBe(true);
        // Partial match (no api/ prefix)
        expect(RouteMatcher.isMatch('api/AdminDashboard/customers/{customerId}', 'AdminDashboard/customers/5')).toBe(
            true,
        );
    });

    it('should match multiple parameters', () => {
        expect(
            RouteMatcher.isMatch('api/companies/{companyId}/employees/{employeeId}', 'api/companies/1/employees/42'),
        ).toBe(true);
    });

    it('should match paths with HTTP method prefixes', () => {
        expect(RouteMatcher.isMatch('[GET] api/customers/{id}', 'api/customers/5')).toBe(true);
        expect(RouteMatcher.isMatch('[POST] api/orders', 'api/orders')).toBe(true);
    });

    it('should handle optional parameters and constraints', () => {
        expect(RouteMatcher.isMatch('api/items/{id:int}', 'api/items/123')).toBe(true);
        expect(RouteMatcher.isMatch('api/items/{id?}', 'api/items/123')).toBe(true);
    });

    it('should not match unrelated paths', () => {
        expect(RouteMatcher.isMatch('api/customers/{id}', 'api/orders/5')).toBe(false);
        expect(RouteMatcher.isMatch('api/customers', 'api/customers/5')).toBe(false);
    });

    it('should identify potential URLs', () => {
        expect(RouteMatcher.isPotentialUrl('api/customers/5')).toBe(true);
        expect(RouteMatcher.isPotentialUrl('customers')).toBe(false);
        expect(RouteMatcher.isPotentialUrl('api customers')).toBe(false);
    });

    it('should handle incomplete paths (fuzzy match)', () => {
        // This is what the user asked about
        expect(
            RouteMatcher.isMatch(
                'api/AdminDashboard/customers/{id}/{id2}/username',
                'AdminDashboard/customers/5/10/usern',
            ),
        ).toBe(true);
    });
});
