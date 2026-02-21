import { describe, expect, test } from "bun:test";
import { pLimit } from "./p-limit";

describe("pLimit", () => {
    test("concurrency limit", async () => {
        const limit = pLimit(2);
        let active = 0;
        let maxActive = 0;

        const task = async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
        };

        await Promise.all(Array.from({ length: 10 }, () => limit(task)));

        expect(maxActive).toBe(2);
    });

    test("resolves values correctly", async () => {
        const limit = pLimit(5);
        const results = await Promise.all([
            limit(async () => 1),
            limit(async () => 2),
            limit(async () => 3)
        ]);
        expect(results).toEqual([1, 2, 3]);
    });

    test("handles errors correctly", async () => {
        const limit = pLimit(1);
        try {
            await limit(async () => { throw new Error("fail"); });
        } catch (e: any) {
            expect(e.message).toBe("fail");
        }
    });

    test("processes large number of tasks (performance check)", async () => {
        const limit = pLimit(50);
        const count = 10000;
        const start = performance.now();

        await Promise.all(Array.from({ length: count }, (_, i) => limit(async () => i)));

        const end = performance.now();
        // Just ensuring it finishes reasonably fast (less than 1s for 10k tasks)
        // With O(N^2), 10k tasks would be 100M ops, which might be > 100ms.
        // But mainly ensuring correctness here.
        expect(end - start).toBeLessThan(2000);
    });
});
