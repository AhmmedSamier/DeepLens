import { describe, expect, it } from 'bun:test';
import { RouteMatcher } from './route-matcher';

describe('RouteMatcher Regression Tests', () => {
    it('should match correctly when query includes a method prefix and parameters', () => {
        const template = 'api/AdminDashboard/companies/{companyId}';
        const queryWithMethod = 'get api/AdminDashboard/companies/20';

        // This was failing because the method 'get' was being treated as part of the first segment
        const score = RouteMatcher.scoreMatch(template, queryWithMethod);
        expect(score).toBeGreaterThan(0);

        // Exact count match should have a high score
        expect(score).toBeGreaterThan(2.0);
    });

    it('should handle different methods correctly', () => {
        const template = 'api/data/{id}';
        expect(RouteMatcher.scoreMatch(template, 'post api/data/123')).toBeGreaterThan(0);
        expect(RouteMatcher.scoreMatch(template, 'DELETE api/data/123')).toBeGreaterThan(0);
        expect(RouteMatcher.scoreMatch(template, 'put /api/data/123')).toBeGreaterThan(0);
    });

    it('should distinguish between exact matches and loose suffix matches even with methods', () => {
        const query = 'get api/AdminDashboard/companies/20';
        const irrelevantRoute = 'api/Roles/{PageNumber}/{PageSize}/{SortBy}/{SortDirection}';
        const relevantRoute = 'api/AdminDashboard/companies/{companyId}';

        const scoreIrrelevant = RouteMatcher.scoreMatch(irrelevantRoute, query);
        const scoreRelevant = RouteMatcher.scoreMatch(relevantRoute, query);

        // Relevant route (exact segment count) should rank higher than suffix match
        expect(scoreRelevant).toBeGreaterThan(scoreIrrelevant);
    });
});
