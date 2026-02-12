/**
 * Interface for pre-processed path to avoid repeated string manipulation
 */
export interface PreparedPath {
    cleanPath: string;
    segments: string[];
    segmentsLower: string[];
}

export interface RoutePattern {
    regex: RegExp;
    cleanTemplate: string;
    templateSegments: string[];
    templateSegmentsLower: string[];
    isParameter: boolean[];
}

/**
 * Utility to match concrete URL paths against ASP.NET route templates.
 */
export class RouteMatcher {
    private static cache = new Map<string, RoutePattern>();
    private static readonly CACHE_LIMIT = 1000;

    /**
     * Pre-process a concrete path for efficient matching against multiple templates.
     */
    static prepare(concretePath: string): PreparedPath {
        const cleanPath = concretePath.trim().replace(/(^\/|\/$)/g, '');
        // If cleanPath is empty, split returns [""] which is length 1. We want empty array.
        const segments = cleanPath.length > 0 ? cleanPath.split('/') : [];
        const segmentsLower = segments.map((s) => s.toLowerCase());
        return { cleanPath, segments, segmentsLower };
    }

    /**
     * Pre-compute the route pattern for a template.
     */
    static precompute(template: string): RoutePattern | null {
        return this.getOrCompileCache(template);
    }

    /**
     * Matches a concrete URL path against a pre-computed route pattern.
     */
    static isMatchPattern(pattern: RoutePattern, concretePath: string | PreparedPath): boolean {
        let cleanPath: string;
        let pathSegments: string[] | undefined;
        let pathSegmentsLower: string[] | undefined;

        if (typeof concretePath === 'string') {
            cleanPath = concretePath.trim().replace(/(^\/|\/$)/g, '');
        } else {
            cleanPath = concretePath.cleanPath;
            pathSegments = concretePath.segments;
            pathSegmentsLower = concretePath.segmentsLower;
        }

        if (!cleanPath) return false;

        try {
            // 1. Try exact match first (Fastest)
            if (pattern.regex.test(cleanPath)) return true;

            // 2. Try segment-based suffix matching
            // Lazy load segments if not provided
            if (!pathSegments) {
                pathSegments = cleanPath.split('/');
            }
            if (!pathSegmentsLower) {
                pathSegmentsLower = pathSegments.map((s) => s.toLowerCase());
            }

            return this.segmentsMatch(pattern, pathSegments, pathSegmentsLower);
        } catch {
            return false;
        }
    }

    /**
     * Matches a concrete URL path against an ASP.NET route template.
     * @param template e.g., "api/AdminDashboard/customers/{customerId}"
     * @param concretePath e.g., "api/AdminDashboard/customers/5" or a PreparedPath object
     */
    static isMatch(template: string, concretePath: string | PreparedPath): boolean {
        const cached = this.getOrCompileCache(template);
        if (!cached) return false;
        return this.isMatchPattern(cached, concretePath);
    }

    private static getOrCompileCache(template: string): RoutePattern | null {
        let cached = this.cache.get(template);
        if (cached) return cached;

        // 1. Clean up inputs
        // Remove HTTP methods like "[GET] " or "[POST] "
        const cleanTemplate = template
            .replace(/^\[[A-Z]+\]\s+/, '')
            .trim()
            .replace(/(^\/|\/$)/g, '');

        if (!cleanTemplate) return null;

        // 2. Convert template to a Regular Expression
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
            const exactRegex = new RegExp(`^${pattern}$`, 'i');
            const templateSegments = cleanTemplate.length > 0 ? cleanTemplate.split('/') : [];
            const templateSegmentsLower = templateSegments.map((s) => s.toLowerCase());
            const isParameter = templateSegments.map((s) => s.startsWith('{') && s.endsWith('}'));

            cached = { regex: exactRegex, cleanTemplate, templateSegments, templateSegmentsLower, isParameter };

            if (this.cache.size >= this.CACHE_LIMIT) {
                // Simple LRU-like: remove the first inserted item
                const firstKey = this.cache.keys().next().value;
                if (firstKey) this.cache.delete(firstKey);
            }
            this.cache.set(template, cached);
            return cached;
        } catch {
            return null;
        }
    }

    /**
     * Check if segments match from the right (supporting parameters)
     */
    private static segmentsMatch(pattern: RoutePattern, pSegs: string[], pSegsLower: string[]): boolean {
        const tSegs = pattern.templateSegments;
        const tSegsLower = pattern.templateSegmentsLower;
        const isParams = pattern.isParameter;

        if (pSegs.length > tSegs.length) {
            return false;
        }

        for (let i = 1; i <= pSegs.length; i++) {
            const index = tSegs.length - i;
            const tSegLower = tSegsLower[index];
            const pSeg = pSegs[pSegs.length - i];
            const pSegLower = pSegsLower[pSegs.length - i];
            const isParam = isParams[index];
            const isLast = i === 1;

            if (!this.segmentMatches(tSegLower, pSeg, pSegLower, isLast, isParam)) {
                return false;
            }
        }
        return true;
    }

    private static segmentMatches(
        tSegLower: string,
        pSeg: string,
        pSegLower: string,
        allowPrefix: boolean,
        isParam: boolean,
    ): boolean {
        // If template segment is a parameter, it matches any non-empty path segment
        if (isParam) {
            return !!pSeg;
        }

        if (allowPrefix) {
            // For the VERY LAST segment specifically, allow prefix matching
            // This enables "usern" to match "username"
            return tSegLower.startsWith(pSegLower);
        }

        // Middle segments must match exactly
        return tSegLower === pSegLower;
    }

    /**
     * Check if a query string looks like a concrete URL path
     */
    static isPotentialUrl(query: string): boolean {
        // If it contains slashes and no spaces, it's likely a URL
        return query.includes('/') && !query.includes(' ') && query.length > 2;
    }
}
