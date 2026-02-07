/**
 * Interface for pre-processed path to avoid repeated string manipulation
 */
export interface PreparedPath {
    cleanPath: string;
    segments: string[];
}

/**
 * Utility to match concrete URL paths against ASP.NET route templates.
 */
export class RouteMatcher {
    private static cache = new Map<string, { regex: RegExp; cleanTemplate: string; templateSegments: string[] }>();
    private static readonly CACHE_LIMIT = 1000;

    /**
     * Pre-process a concrete path for efficient matching against multiple templates.
     */
    static prepare(concretePath: string): PreparedPath {
        const cleanPath = concretePath.trim().replace(/(^\/|\/$)/g, '');
        // If cleanPath is empty, split returns [""] which is length 1. We want empty array.
        const segments = cleanPath.length > 0 ? cleanPath.split('/') : [];
        return { cleanPath, segments };
    }

    /**
     * Matches a concrete URL path against an ASP.NET route template.
     * @param template e.g., "api/AdminDashboard/customers/{customerId}"
     * @param concretePath e.g., "api/AdminDashboard/customers/5" or a PreparedPath object
     */
    static isMatch(template: string, concretePath: string | PreparedPath): boolean {
        let cleanPath: string;
        let pathSegments: string[] | undefined;

        if (typeof concretePath === 'string') {
            cleanPath = concretePath.trim().replace(/(^\/|\/$)/g, '');
        } else {
            cleanPath = concretePath.cleanPath;
            pathSegments = concretePath.segments;
        }

        if (!cleanPath) return false;

        const cached = this.getOrCompileCache(template);
        if (!cached) return false;

        try {
            // 1. Try exact match first (Fastest)
            if (cached.regex.test(cleanPath)) return true;

            // 2. Try segment-based suffix matching
            // Lazy load segments if not provided
            if (!pathSegments) {
                pathSegments = cleanPath.split('/');
            }

            return this.segmentsMatch(cached.templateSegments, pathSegments);
        } catch {
            return false;
        }
    }

    private static getOrCompileCache(template: string): {
        regex: RegExp;
        cleanTemplate: string;
        templateSegments: string[];
    } | null {
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

            cached = { regex: exactRegex, cleanTemplate, templateSegments };

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
    private static segmentsMatch(tSegs: string[], pSegs: string[]): boolean {
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
