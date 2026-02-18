/**
 * Interface for pre-processed path to avoid repeated string manipulation
 */
export interface PreparedPath {
    cleanPath: string;
    segments: string[];
    segmentsLower: string[];
    method?: string;
}

export interface RoutePattern {
    regex: RegExp;
    cleanTemplate: string;
    templateSegments: string[];
    templateSegmentsLower: string[];
    // Optimization: Pre-calculated boolean array to avoid repeated string checks (startsWith/endsWith) in the hot loop
    isParameter: boolean[];
    method?: string;
}

/**
 * Utility to match concrete URL paths against ASP.NET route templates.
 */
export class RouteMatcher {
    private static readonly cache = new Map<string, RoutePattern>();
    private static readonly CACHE_LIMIT = 1000;

    /**
     * Pre-process a concrete path for efficient matching against multiple templates.
     */
    static prepare(concretePath: string): PreparedPath {
        const trimmed = concretePath.trim();
        const firstSpaceIndex = trimmed.indexOf(' ');
        let pathOnly = trimmed;
        let method: string | undefined;
        if (firstSpaceIndex > 0) {
            const candidateMethod = trimmed.slice(0, firstSpaceIndex).toUpperCase();
            const rest = trimmed.slice(firstSpaceIndex + 1);
            if (rest.length > 0) {
                switch (candidateMethod) {
                    case 'GET':
                    case 'POST':
                    case 'PUT':
                    case 'DELETE':
                    case 'PATCH':
                    case 'OPTIONS':
                    case 'HEAD':
                    case 'TRACE':
                        method = candidateMethod;
                        pathOnly = rest;
                        break;
                    default:
                        break;
                }
            }
        }

        const cleanPath = pathOnly.trim().replace(/(^\/|\/$)/g, '');
        // If cleanPath is empty, split returns [""] which is length 1. We want empty array.
        const segments = cleanPath.length > 0 ? cleanPath.split('/') : [];
        const segmentsLower = segments.map((s) => s.toLowerCase());
        return { cleanPath, segments, segmentsLower, method };
    }

    /**
     * Pre-compute the route pattern for a template.
     */
    static precompute(template: string): RoutePattern | null {
        return this.getOrCompileCache(template);
    }

    /**
     * Matches a concrete URL path against a pre-computed route pattern and returns a score.
     */
    static scoreMatchPattern(pattern: RoutePattern, concretePath: string | PreparedPath): number {
        let cleanPath: string;
        let pathSegments: string[] | undefined;
        let pathSegmentsLower: string[] | undefined;

        if (typeof concretePath === 'string') {
            const prepared = this.prepare(concretePath);
            cleanPath = prepared.cleanPath;
            pathSegments = prepared.segments;
            pathSegmentsLower = prepared.segmentsLower;
        } else {
            cleanPath = concretePath.cleanPath;
            pathSegments = concretePath.segments;
            pathSegmentsLower = concretePath.segmentsLower;
        }

        if (!cleanPath) return 0;

        try {
            // 1. Try exact match first (Fastest)
            if (pattern.regex.test(cleanPath)) {
                let score = 2;
                if (!pathSegments) {
                    pathSegments = cleanPath.split('/');
                }

                const count = Math.min(pathSegments.length, pattern.templateSegments.length);
                for (let i = 0; i < count; i++) {
                    if (!pattern.isParameter[i]) {
                        score += 0.1;
                    }
                }
                return score;
            }

            // 2. Try segment-based suffix matching
            if (!pathSegments) {
                pathSegments = cleanPath.split('/');
            }
            if (!pathSegmentsLower) {
                pathSegmentsLower = pathSegments.map((s) => s.toLowerCase());
            }

            return this.calculateSegmentsScore(
                pattern.templateSegments,
                pattern.templateSegmentsLower,
                pathSegments,
                pathSegmentsLower,
                pattern.isParameter,
            );
        } catch {
            return 0;
        }
    }

    /**
     * Matches a concrete URL path against a pre-computed route pattern.
     */
    static isMatchPattern(pattern: RoutePattern, concretePath: string | PreparedPath): boolean {
        return this.scoreMatchPattern(pattern, concretePath) > 0;
    }

    /**
     * Matches a concrete URL path against an ASP.NET route template and returns a score.
     */
    static scoreMatch(template: string, concretePath: string | PreparedPath): number {
        const cached = this.getOrCompileCache(template);
        if (!cached) return 0;
        return this.scoreMatchPattern(cached, concretePath);
    }

    /**
     * Matches a concrete URL path against an ASP.NET route template.
     * @param template e.g., "api/AdminDashboard/customers/{customerId}"
     * @param concretePath e.g., "api/AdminDashboard/customers/5" or a PreparedPath object
     */
    static isMatch(template: string, concretePath: string | PreparedPath): boolean {
        return this.scoreMatch(template, concretePath) > 0;
    }

    private static getOrCompileCache(template: string): RoutePattern | null {
        let cached = this.cache.get(template);
        if (cached) return cached;

        // 1. Clean up inputs
        // Remove HTTP methods like "[GET] " or "[POST] "
        const methodMatch = /^\[([A-Z]+)\]/.exec(template);
        const method = methodMatch ? methodMatch[1] : undefined;

        const cleanTemplate = template
            .replace(/^\[[A-Z]+\]\s*/, '')
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

            cached = { regex: exactRegex, cleanTemplate, templateSegments, templateSegmentsLower, isParameter, method };

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

    private static calculateSegmentsScore(
        tSegs: string[],
        tSegsLower: string[],
        pSegs: string[],
        pSegsLower: string[],
        isParams: boolean[],
    ): number {
        if (pSegs.length > tSegs.length) {
            return 0;
        }

        let score = 1;
        const isExactCount = pSegs.length === tSegs.length;
        if (isExactCount) {
            score = 2;
        }

        for (let i = 1; i <= pSegs.length; i++) {
            const index = tSegs.length - i;
            const tSegLower = tSegsLower[index];
            const pSeg = pSegs[pSegs.length - i];
            const pSegLower = pSegsLower[pSegs.length - i];
            const isParam = isParams[index];
            const isLast = i === 1;

            const { delta, isMatch } = this.calculateSingleSegmentScore(tSegLower, pSeg, pSegLower, isParam, isLast);
            if (!isMatch) {
                return 0;
            }
            score += delta;
        }
        return score;
    }

    private static calculateSingleSegmentScore(
        templateSegmentLower: string,
        pathSegment: string,
        pathSegmentLower: string,
        isParam: boolean,
        isLast: boolean,
    ): { delta: number; isMatch: boolean } {
        if (isParam) {
            if (!pathSegment) {
                return { delta: 0, isMatch: false };
            }
            return { delta: 0, isMatch: true };
        }

        if (!pathSegmentLower) {
            return { delta: 0, isMatch: false };
        }

        if (isLast && templateSegmentLower.startsWith(pathSegmentLower)) {
            const isExactMatch = templateSegmentLower === pathSegmentLower;
            return { delta: isExactMatch ? 0.1 : 0.05, isMatch: true };
        }

        if (templateSegmentLower === pathSegmentLower) {
            return { delta: 0.1, isMatch: true };
        }

        return { delta: 0, isMatch: false };
    }

    /**
     * Check if a query string looks like a concrete URL path
     */
    static isPotentialUrl(query: string): boolean {
        const q = query.trim();
        if (q.includes('/') && !q.includes(' ') && q.length > 2) return true;

        // Match "get api/..." or "post /api/..."
        const methodMatch = /^(get|post|put|delete|patch|options|head|trace)\s+[/\w]/i.exec(q);
        return !!methodMatch;
    }
}
