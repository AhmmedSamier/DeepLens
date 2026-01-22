/**
 * specific MinHeap implementation for keeping top-k results
 */
export class MinHeap<T> {
    private heap: T[];
    private compare: (a: T, b: T) => number;
    private maxSize: number;

    constructor(maxSize: number, compare: (a: T, b: T) => number) {
        this.heap = [];
        this.maxSize = maxSize;
        this.compare = compare;
    }

    push(item: T): void {
        if (this.heap.length < this.maxSize) {
            this.heap.push(item);
            this.siftUp(this.heap.length - 1);
        } else if (this.compare(item, this.heap[0]) > 0) {
            this.heap[0] = item;
            this.siftDown(0);
        }
    }

    peek(): T | undefined {
        return this.heap[0];
    }

    getSorted(): T[] {
        // Returns sorted descending (highest score first)
        // Since it's a min-heap, popping gives us elements in ascending order.
        // So we pop all, then reverse.
        const result: T[] = [];
        const originalHeap = [...this.heap];

        // We destructively empty the heap to sort
        while (this.heap.length > 0) {
            result.push(this.pop()!);
        }

        // Restore heap state
        this.heap = originalHeap;

        return result.reverse();
    }

    private pop(): T | undefined {
        if (this.heap.length === 0) return undefined;
        const root = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0 && last !== undefined) {
            this.heap[0] = last;
            this.siftDown(0);
        }
        return root;
    }

    private siftUp(index: number): void {
        let nodeIndex = index;
        while (nodeIndex > 0) {
            const parentIndex = (nodeIndex - 1) >>> 1;
            if (this.compare(this.heap[nodeIndex], this.heap[parentIndex]) < 0) {
                this.swap(nodeIndex, parentIndex);
                nodeIndex = parentIndex;
            } else {
                break;
            }
        }
    }

    private siftDown(index: number): void {
        let nodeIndex = index;
        const length = this.heap.length;
        const halfLength = length >>> 1;

        while (nodeIndex < halfLength) {
            const leftIndex = (nodeIndex << 1) + 1;
            const rightIndex = leftIndex + 1;
            let smallerChildIndex = leftIndex;

            if (rightIndex < length && this.compare(this.heap[rightIndex], this.heap[leftIndex]) < 0) {
                smallerChildIndex = rightIndex;
            }

            if (this.compare(this.heap[smallerChildIndex], this.heap[nodeIndex]) < 0) {
                this.swap(smallerChildIndex, nodeIndex);
                nodeIndex = smallerChildIndex;
            } else {
                break;
            }
        }
    }

    private swap(i: number, j: number): void {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }
}
