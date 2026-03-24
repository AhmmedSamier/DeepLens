/**
 * specific MinHeap implementation for keeping top-k results
 */
export class MinHeap<T> {
  private heap: T[];
  private readonly compare: (a: T, b: T) => number;
  private readonly maxSize: number;

  constructor(maxSize: number, compare: (a: T, b: T) => number) {
    this.heap = [];
    this.maxSize = maxSize;
    this.compare = compare;
  }

  isFull(): boolean {
    return this.heap.length >= this.maxSize;
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
    // ⚡ Bolt: Fast sorting optimization
    // Using native Array.prototype.sort() on a shallow copy is measurably faster
    // than manually popping and shifting elements down, as it leverages native V8 sorting
    // and avoids repeated siftDown operations.
    // Returns sorted descending (highest score first) by reversing the compare function arguments.
    // eslint-disable-next-line sonarjs/arguments-order
    return this.heap.slice().sort((a, b) => this.compare(b, a));
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
