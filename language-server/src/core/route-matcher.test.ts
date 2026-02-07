import { describe, expect, it } from 'bun:test';
import { MatchStrength, RouteMatcher } from './route-matcher';

describe('RouteMatcher', () => {
    it('should match exact paths', () => {
        expect(RouteMatcher.isMatch('api/customers', 'api/customers')).toBe(MatchStrength.Exact);
        expect(RouteMatcher.isMatch('/api/customers/', 'api/customers')).toBe(MatchStrength.Exact);
    });

    it('should match parameterized paths', () => {
        expect(RouteMatcher.isMatch('api/customers/{id}', 'api/customers/5')).toBe(MatchStrength.Exact);
        expect(RouteMatcher.isMatch('api/customers/{id}', 'api/customers/abc')).toBe(MatchStrength.Exact);
        expect(
            RouteMatcher.isMatch('api/AdminDashboard/customers/{customerId}', 'api/AdminDashboard/customers/5'),
        ).toBe(MatchStrength.Exact);
        // Partial match (no api/ prefix)
        expect(RouteMatcher.isMatch('api/AdminDashboard/customers/{customerId}', 'AdminDashboard/customers/5')).toBe(
            MatchStrength.FuzzySuffix,
        );
    });

    it('should match multiple parameters', () => {
        expect(
            RouteMatcher.isMatch('api/companies/{companyId}/employees/{employeeId}', 'api/companies/1/employees/42'),
        ).toBe(MatchStrength.Exact);
    });

    it('should match paths with HTTP method prefixes', () => {
        expect(RouteMatcher.isMatch('[GET] api/customers/{id}', 'api/customers/5')).toBe(MatchStrength.Exact);
        expect(RouteMatcher.isMatch('[POST] api/orders', 'api/orders')).toBe(MatchStrength.Exact);
    });

    it('should handle optional parameters and constraints', () => {
        expect(RouteMatcher.isMatch('api/items/{id:int}', 'api/items/123')).toBe(MatchStrength.Exact);
        expect(RouteMatcher.isMatch('api/items/{id?}', 'api/items/123')).toBe(MatchStrength.Exact);
    });

    it('should not match unrelated paths', () => {
        expect(RouteMatcher.isMatch('api/customers/{id}', 'api/orders/5')).toBe(MatchStrength.None);
        expect(RouteMatcher.isMatch('api/customers', 'api/customers/5')).toBe(MatchStrength.None);
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
        ).toBe(MatchStrength.FuzzySuffix);
    });

    it('should identify queries with methods as potential URLs', () => {
        expect(RouteMatcher.isPotentialUrl('get api/users/1')).toBe(true);
        expect(RouteMatcher.isPotentialUrl('POST api/users')).toBe(true);
        expect(RouteMatcher.isPotentialUrl('delete /api/users/1')).toBe(true);
        // Still reject random sentences
        expect(RouteMatcher.isPotentialUrl('get some random stuff')).toBe(false);
    });

    it('should match queries with method prefixes against templates', () => {
        // Template has [GET], Query has "get "
        expect(RouteMatcher.isMatch('[GET] api/users/{id}', 'get api/users/1')).toBe(MatchStrength.Exact);
        // Template has no method, Query has "GET "
        expect(RouteMatcher.isMatch('api/users/{id}', 'GET api/users/1')).toBe(MatchStrength.Exact);
        // Template has [POST], Query has "post "
        expect(RouteMatcher.isMatch('[POST] api/users', 'post api/users')).toBe(MatchStrength.Exact);
    });
});
