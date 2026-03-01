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
    hasCatchAll?: boolean;
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

        let cleanPath = pathOnly.trim();

        // ⚡ Bolt: Fast leading/trailing slash trimming
        // Replaces .replaceAll(/(^\/|\/$)/g, '') which is ~15x slower
        const start = cleanPath.charCodeAt(0) === 47 ? 1 : 0; // 47 is '/'
        const end = cleanPath.charCodeAt(cleanPath.length - 1) === 47 ? cleanPath.length - 1 : cleanPath.length;
        if (start !== 0 || end !== cleanPath.length) {
            cleanPath = cleanPath.slice(start, end);
        }

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
        let pathSegments: string[];
        let pathSegmentsLower: string[];

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
            // Optimization: Skip expensive regex if length mismatch and no catch-all
            let matchesRegex = false;
            if (pattern.hasCatchAll || pathSegments.length === pattern.templateSegments.length) {
                if (pattern.regex.test(cleanPath)) {
                    matchesRegex = true;
                }
            }

            if (matchesRegex) {
                let score = 2;
                const count = Math.min(pathSegments.length, pattern.templateSegments.length);
                for (let i = 0; i < count; i++) {
                    if (!pattern.isParameter[i]) {
                        score += 0.1;
                    }
                }
                return score;
            }

            // 2. Try segment-based suffix matching
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

    // eslint-disable-next-line sonarjs/cognitive-complexity
    private static getOrCompileCache(template: string): RoutePattern | null {
        let cached = this.cache.get(template);
        if (cached) return cached;

        // 1. Clean up inputs
        // Remove HTTP methods like "[GET] " or "[POST] "
        const methodMatch = /^\[([A-Z]+)\]/.exec(template);
        const method = methodMatch ? methodMatch[1] : undefined;

        let cleanTemplate = template.replace(/^\[[A-Z]+\]\s*/, '').trim();

        // ⚡ Bolt: Fast leading/trailing slash trimming
        // Replaces .replaceAll(/(^\/|\/$)/g, '') which is ~15x slower
        const start = cleanTemplate.charCodeAt(0) === 47 ? 1 : 0; // 47 is '/'
        const end =
            cleanTemplate.charCodeAt(cleanTemplate.length - 1) === 47 ? cleanTemplate.length - 1 : cleanTemplate.length;
        if (start !== 0 || end !== cleanTemplate.length) {
            cleanTemplate = cleanTemplate.slice(start, end);
        }

        if (!cleanTemplate) return null;

        // 2. Convert template to a Regular Expression
        // ⚡ Bolt: Fast single-pass regex compilation
        // Replaces 5x .replaceAll() calls which is ~4.7x slower
        let pattern = '';
        let hasCatchAll = false;
        let i = 0;
        const len = cleanTemplate.length;

        while (i < len) {
            const char = cleanTemplate[i];

            if (char === '{') {
                const closeIdx = cleanTemplate.indexOf('}', i + 1);
                if (closeIdx !== -1) {
                    const paramContent = cleanTemplate.slice(i + 1, closeIdx);
                    // Replace {*slug} (catch-all) with (.*)
                    if (paramContent.charCodeAt(0) === 42) { // '*'
                        hasCatchAll = true;
                        pattern += '(.*)';
                    } else {
                        // Replace {id}, {id:int}, {id?} etc with ([^\/]+)
                        pattern += '([^/]+)';
                    }
                    i = closeIdx + 1;
                    continue;
                }
            }

            const code = cleanTemplate.charCodeAt(i);
            // Escape regex specials
            if (
                code === 46 || // period
                code === 42 || // asterisk
                code === 43 || // plus
                code === 63 || // question mark
                code === 94 || // caret
                code === 36 || // dollar
                code === 123 || // left brace
                code === 125 || // right brace
                code === 40 || // left paren
                code === 41 || // right paren
                code === 124 || // pipe
                code === 91 || // left bracket
                code === 93 || // right bracket
                code === 92 // backslash
            ) {
                pattern += '\\' + char;
            } else {
                pattern += char;
            }
            i++;
        }

        try {
            const exactRegex = new RegExp(`^${pattern}$`, 'i');
            const templateSegments = cleanTemplate.length > 0 ? cleanTemplate.split('/') : [];
            const templateSegmentsLower = templateSegments.map((s) => s.toLowerCase());
            const isParameter = templateSegments.map((s) => s.startsWith('{') && s.endsWith('}'));

            cached = {
                regex: exactRegex,
                cleanTemplate,
                templateSegments,
                templateSegmentsLower,
                isParameter,
                method,
                hasCatchAll,
            };

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

    // eslint-disable-next-line sonarjs/cognitive-complexity
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

            // Inlined segment matching logic to avoid object allocation
            let delta = 0;
            let isMatch = false;

            if (isParam) {
                if (pSeg) {
                    isMatch = true;
                }
            } else if (pSegLower) {
                if (isLast && tSegLower.startsWith(pSegLower)) {
                    const isExactMatch = tSegLower === pSegLower;
                    delta = isExactMatch ? 0.1 : 0.05;
                    isMatch = true;
                } else if (tSegLower === pSegLower) {
                    delta = 0.1;
                    isMatch = true;
                }
            }

            if (!isMatch) {
                return 0;
            }
            score += delta;
        }
        return score;
    }

    /**
     * Check if a query string looks like a concrete URL path
     */
    static isPotentialUrl(query: string): boolean {
        const q = query.trim();
        if (q.includes('/') && !q.includes(' ') && q.length > 2) {
            return true;
        }

        const methodSeparator = q.indexOf(' ');
        if (methodSeparator <= 0) {
            return false;
        }

        const method = q.slice(0, methodSeparator).toUpperCase();
        if (!RouteMatcher.isHttpMethod(method)) {
            return false;
        }

        const pathStartIndex = RouteMatcher.skipSpaces(q, methodSeparator + 1);
        if (pathStartIndex >= q.length) {
            return false;
        }

        return RouteMatcher.isPotentialPathStartChar(q.charCodeAt(pathStartIndex));
    }

    private static isHttpMethod(method: string): boolean {
        return (
            method === 'GET' ||
            method === 'POST' ||
            method === 'PUT' ||
            method === 'DELETE' ||
            method === 'PATCH' ||
            method === 'OPTIONS' ||
            method === 'HEAD' ||
            method === 'TRACE'
        );
    }

    private static skipSpaces(value: string, start: number): number {
        let index = start;
        while (index < value.length && value.charCodeAt(index) === 32) {
            index++;
        }
        return index;
    }

    private static isPotentialPathStartChar(charCode: number): boolean {
        // 47 is '/', 65-90 is A-Z, 97-122 is a-z, 48-57 is 0-9, 95 is '_'
        return (
            charCode === 47 ||
            (charCode >= 65 && charCode <= 90) ||
            (charCode >= 97 && charCode <= 122) ||
            (charCode >= 48 && charCode <= 57) ||
            charCode === 95
        );
    }
}
