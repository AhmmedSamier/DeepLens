import { describe, expect, it } from 'bun:test';
import { MinHeap } from './min-heap';

describe('MinHeap', () => {
    it('should maintain capacity and evict smallest items when full', () => {
        // MinHeap keeps TOP-K largest items.
        // It's a MinHeap of size K. The root is the Minimum of the Top K.
        // If a new item is larger than the root, we replace root and sift down.
        // So after processing, the heap contains the K largest items.
        // And getSorted() returns them descending.

        const heap = new MinHeap<number>(3, (a, b) => a - b);

        heap.push(10);
        heap.push(50);
        heap.push(30);

        // Heap: [10, 50, 30] (approx)
        expect(heap.isFull()).toBe(true);
        expect(heap.peek()).toBe(10); // Smallest of the top 3

        // Push 5 (smaller than min): Should be ignored or rejected if we checked peek outside,
        // but internal push implementation:
        // if full, compares with heap[0]. 5 - 10 < 0. 5 is not greater than 10.
        // So 10 remains. 5 is discarded (it's not in the top K).
        heap.push(5);
        expect(heap.peek()).toBe(10);

        // Push 100 (larger than min): Should replace 10.
        heap.push(100);
        // Heap now has 30, 50, 100. Min is 30.
        expect(heap.peek()).toBe(30);
    });

    it('should sort items correctly', () => {
        const heap = new MinHeap<number>(5, (a, b) => a - b);
        [10, 5, 20, 2, 8, 15, 25].forEach(n => heap.push(n));

        // Top 5 of [2, 5, 8, 10, 15, 20, 25] are [25, 20, 15, 10, 8]
        // The heap should contain [8, 10, 15, 20, 25] (unordered internal state)
        // peek() should be 8.
        expect(heap.peek()).toBe(8);

        const sorted = heap.getSorted();
        expect(sorted).toEqual([25, 20, 15, 10, 8]);
    });

    it('should handle custom objects', () => {
        interface Item { val: number; id: string }
        const heap = new MinHeap<Item>(2, (a, b) => a.val - b.val);

        heap.push({ val: 10, id: 'a' });
        heap.push({ val: 20, id: 'b' });
        heap.push({ val: 5, id: 'c' }); // Ignored
        heap.push({ val: 30, id: 'd' }); // Replaces 10

        // Should have 30 and 20. Min is 20.
        expect(heap.peek()?.val).toBe(20);

        const sorted = heap.getSorted();
        expect(sorted.map(x => x.val)).toEqual([30, 20]);
    });

    it('should handle underfilled heap', () => {
        const heap = new MinHeap<number>(10, (a, b) => a - b);
        heap.push(5);
        heap.push(1);

        expect(heap.isFull()).toBe(false);
        const sorted = heap.getSorted();
        expect(sorted).toEqual([5, 1]);
    });
});
