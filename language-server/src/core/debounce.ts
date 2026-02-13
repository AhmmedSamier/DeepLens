/**
 * Debounce utility for batching rapid function calls
 */
export class Debouncer<T = void> {
    private timeoutId: NodeJS.Timeout | undefined;
    private pendingArgs: T[] = [];

    constructor(
        private callback: (args: T[]) => void | Promise<void>,
        private delayMs: number,
    ) {}

    /**
     * Schedule a call with the given argument
     * Multiple calls within the delay period will be batched
     */
    schedule(arg: T): void {
        this.pendingArgs.push(arg);

        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }

        this.timeoutId = setTimeout(() => {
            this.flush();
        }, this.delayMs);
    }

    /**
     * Immediately execute pending calls
     */
    flush(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        if (this.pendingArgs.length > 0) {
            const args = [...this.pendingArgs];
            this.pendingArgs = [];
            this.callback(args);
        }
    }

    /**
     * Cancel pending calls
     */
    cancel(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        this.pendingArgs = [];
    }

    /**
     * Dispose and cancel any pending calls
     */
    dispose(): void {
        this.cancel();
    }
}

/**
 * Simple debounce function for single-argument callbacks
 */
export function debounce<T extends (...args: any[]) => any>(func: T, waitMs: number): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | undefined;

    return function (this: any, ...args: Parameters<T>) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, waitMs);
    };
}

/**
 * Throttle function - ensures function is called at most once per interval
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    limitMs: number,
): (...args: Parameters<T>) => void {
    let lastCall = 0;
    let timeoutId: NodeJS.Timeout | undefined;

    return function (this: any, ...args: Parameters<T>) {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;

        if (timeSinceLastCall >= limitMs) {
            lastCall = now;
            func.apply(this, args);
        } else {
            // Schedule for later if not already scheduled
            if (!timeoutId) {
                timeoutId = setTimeout(() => {
                    lastCall = Date.now();
                    timeoutId = undefined;
                    func.apply(this, args);
                }, limitMs - timeSinceLastCall);
            }
        }
    };
}
