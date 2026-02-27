/**
 * Simple concurrency limiter for Promise execution
 * Optimized to avoid O(N^2) queue shifting for large task lists
 */
export function pLimit(concurrency: number) {
    const queue: Array<(() => void) | null> = [];
    let head = 0;
    let activeCount = 0;

    const next = () => {
        activeCount--;

        // Process next item in queue
        if (head < queue.length) {
            const fn = queue[head];
            queue[head] = null;
            head++;

            // fn should be defined because we only increment head after reading
            if (fn) fn();
        }
    };

    const run = async <T>(fn: () => Promise<T>, resolve: (val: T) => void, reject: (err: unknown) => void) => {
        activeCount++;
        // Start execution
        const result = (async () => fn())();

        try {
            const res = await result;
            resolve(res);
        } catch (err) {
            reject(err);
        }

        next();
    };

    // The returned function enqueues the task
    return <T>(fn: () => Promise<T>) =>
        new Promise<T>((resolve, reject) => {
            if (activeCount < concurrency) {
                // Can run immediately
                run(fn, resolve, reject);
            } else {
                // Queue for later
                queue.push(() => run(fn, resolve, reject));
            }
        });
}
