/**
 * Utility to match concrete URL paths against ASP.NET route templates.
 */
export class RouteMatcher {
    /**
     * Matches a concrete URL path against an ASP.NET route template.
     * @param template e.g., "api/AdminDashboard/customers/{customerId}"
     * @param concretePath e.g., "api/AdminDashboard/customers/5"
     */
    static isMatch(template: string, concretePath: string): boolean {
        // 1. Clean up inputs
        // Remove HTTP methods like "[GET] " or "[POST] "
        const cleanTemplate = template
            .replace(/^\[[A-Z]+\]\s+/, '')
            .trim()
            .replace(/(^\/|\/$)/g, '');
        const cleanPath = concretePath.trim().replace(/(^\/|\/$)/g, '');

        if (!cleanTemplate || !cleanPath) {
            return false;
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

        // Ensure we handle the escaped slashes correctly (they were escaped in the step above)
        // No additional step needed for slashes as they are already escaped as \/

        try {
            // 1. Try exact match first (Fastest)
            const exactRegex = new RegExp(`^${pattern}$`, 'i');
            if (exactRegex.test(cleanPath)) return true;

            // 2. Try segment-based suffix matching
            // This handles cases like:
            // Template: "api/AdminDashboard/customers/{id}"
            // Path: "AdminDashboard/customers/5"
            return this.segmentsMatch(cleanTemplate, cleanPath);
        } catch {
            return false;
        }
    }

    /**
     * Check if segments match from the right (supporting parameters)
     */
    private static segmentsMatch(template: string, path: string): boolean {
        const tSegs = template.split('/');
        const pSegs = path.split('/');

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
