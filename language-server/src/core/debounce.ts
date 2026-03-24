/**
 * Debounce utility for batching rapid function calls
 */
export class Debouncer<T = void> {
    private timeoutId: NodeJS.Timeout | null = null;
    private pendingArgs: T[] = [];

    constructor(
        private readonly callback: (args: T[]) => void | Promise<void>,
        private readonly delayMs: number,
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
            this.timeoutId = null;
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
            this.timeoutId = null;
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
export function debounce<TArgs extends unknown[]>(
    func: (...args: TArgs) => void,
    waitMs: number,
): (...args: TArgs) => void {
    let timeoutId: NodeJS.Timeout | null = null;

    return function (...args: TArgs) {
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
export function throttle<TArgs extends unknown[]>(
    func: (...args: TArgs) => void,
    limitMs: number,
): (...args: TArgs) => void {
    let lastCall = 0;
    let timeoutId: NodeJS.Timeout | null = null;

    return function (...args: TArgs) {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;

        if (timeSinceLastCall >= limitMs) {
            lastCall = now;
            func.apply(this, args);
        } else if (!timeoutId) {
            // Schedule for later if not already scheduled
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                timeoutId = null;
                func.apply(this, args);
            }, limitMs - timeSinceLastCall);
        }
    };
}
