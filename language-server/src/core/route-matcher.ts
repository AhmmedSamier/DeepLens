/**
 * Utility to match concrete URL paths against ASP.NET route templates.
 */

export interface ParsedRoute {
    cleanTemplate: string;
    segments: string[];
    regex: RegExp;
}

export interface ParsedPath {
    cleanPath: string;
    segments: string[];
}

export class RouteMatcher {
    private static cache = new Map<string, ParsedRoute>();
    private static readonly CACHE_LIMIT = 1000;

    /**
     * Parses a route template into a reusable structure.
     */
    static parseRoute(template: string): ParsedRoute | null {
        // Try to get from cache
        const cached = this.cache.get(template);
        if (cached) {
            return cached;
        }

        // 1. Clean up inputs
        // Remove HTTP methods like "[GET] " or "[POST] "
        const cleanTemplate = template
            .replace(/^\[[A-Z]+\]\s+/, '')
            .trim()
            .replace(/(^\/|\/$)/g, '');

        if (!cleanTemplate) {
            return null;
        }

        // 2. Convert template to a Regular Expression
        // We handle placeholders first, then escape other characters
        let pattern = cleanTemplate;

        // Replace {*slug} (catch-all) with (.*)
        pattern = pattern.replace(/\{(\*\w+)\}/g, '___CATCHALL___');

        // Replace {id}, {id:int}, {id?} etc with ([^\/]+)
        pattern = pattern.replace(/\{[\w?]+(?::\w+)?\}/g, '___PARAM___');

        // Escape regex specials
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Restore our markers with regex groups
        pattern = pattern.replace(/___PARAM___/g, '([^\\/]+)');
        pattern = pattern.replace(/___CATCHALL___/g, '(.*)');

        try {
            const regex = new RegExp(`^${pattern}$`, 'i');
            const parsed: ParsedRoute = {
                cleanTemplate,
                segments: cleanTemplate.split('/'),
                regex
            };

            // Update cache
            if (this.cache.size >= this.CACHE_LIMIT) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) this.cache.delete(firstKey);
            }
            this.cache.set(template, parsed);

            return parsed;
        } catch {
            return null;
        }
    }

    /**
     * Parses a concrete path into a reusable structure.
     */
    static parsePath(concretePath: string): ParsedPath | null {
        const cleanPath = concretePath.trim().replace(/(^\/|\/$)/g, '');
        if (!cleanPath) {
            return null;
        }
        return {
            cleanPath,
            segments: cleanPath.split('/')
        };
    }

    /**
     * Matches a parsed path against a parsed route template.
     */
    static matchesParsed(route: ParsedRoute, path: ParsedPath): boolean {
        // 1. Try exact match first (Fastest)
        if (route.regex.test(path.cleanPath)) return true;

        // 2. Try segment-based suffix matching
        return this.segmentsMatchParsed(route.segments, path.segments);
    }

    /**
     * Matches a concrete URL path against an ASP.NET route template.
     * @param template e.g., "api/AdminDashboard/customers/{customerId}"
     * @param concretePath e.g., "api/AdminDashboard/customers/5"
     */
    static isMatch(template: string, concretePath: string): boolean {
        const route = this.parseRoute(template);
        const path = this.parsePath(concretePath);

        if (!route || !path) {
            return false;
        }

        return this.matchesParsed(route, path);
    }

    /**
     * Check if segments match from the right (supporting parameters)
     */
    private static segmentsMatch(template: string, path: string): boolean {
        const tSegs = template.split('/');
        const pSegs = path.split('/');
        return this.segmentsMatchParsed(tSegs, pSegs);
    }

    private static segmentsMatchParsed(tSegs: string[], pSegs: string[]): boolean {
        if (pSegs.length > tSegs.length) {
            return false;
        }

        for (let i = 1; i <= pSegs.length; i++) {
            const tSeg = tSegs[tSegs.length - i];
            const pSeg = pSegs[pSegs.length - i];
            const isLast = i === 1;

            if (!this.segmentMatches(tSeg, pSeg, isLast)) {
                return false;
            }
        }
        return true;
    }

    private static segmentMatches(tSeg: string, pSeg: string, allowPrefix: boolean): boolean {
        // If template segment is a parameter, it matches any non-empty path segment
        if (tSeg.startsWith('{') && tSeg.endsWith('}')) {
            return !!pSeg;
        }

        if (allowPrefix) {
            // For the VERY LAST segment specifically, allow prefix matching
            // This enables "usern" to match "username"
            return tSeg.toLowerCase().startsWith(pSeg.toLowerCase());
        }

        // Middle segments must match exactly
        return tSeg.toLowerCase() === pSeg.toLowerCase();
    }

    /**
     * Check if a query string looks like a concrete URL path
     */
    static isPotentialUrl(query: string): boolean {
        // If it contains slashes and no spaces, it's likely a URL
        return query.includes('/') && !query.includes(' ') && query.length > 2;
    }
}
