#!/bin/bash
patch -p1 << 'PATCH'
--- a/src/core/search-engine.ts
+++ b/src/core/search-engine.ts
@@ -183,6 +183,9 @@
         topIndices: number[];
     } | null = null;

+    private visitedBuffer: Uint8Array = new Uint8Array(0);
+    private visitedTracker: number[] = [];
+
     public itemsMap: Map<string, SearchableItem> = new Map();
     private readonly fileItemByNormalizedPath: Map<string, SearchableItem> = new Map();
     private activityWeight: number = 0.3;
@@ -1631,16 +1634,29 @@
         const searchContext = this.prepareSearchContext(query, scope);
         // ⚡ Bolt: Fast integer ID tracking using Uint8Array instead of Set
         const preferredIndices = this.getPreferredIndicesForQuery(scope, query, indices);
-        const visited = preferredIndices.length > 0 ? new Uint8Array(this.items.length) : undefined;
-
-        if (preferredIndices.length > 0) {
-            this.searchWithIndices(preferredIndices, searchContext, heap, token, visited);
+
+        const useVisited = preferredIndices.length > 0;
+        if (useVisited && this.visitedBuffer.length < this.items.length) {
+            this.visitedBuffer = new Uint8Array(this.items.length);
         }

-        if (indices) {
-            this.searchWithIndices(indices, searchContext, heap, token, visited);
-        } else {
-            this.searchAllItems(searchContext, heap, token, visited);
+        try {
+            if (preferredIndices.length > 0) {
+                this.searchWithIndices(preferredIndices, searchContext, heap, token, useVisited);
+            }
+
+            if (indices) {
+                this.searchWithIndices(indices, searchContext, heap, token, useVisited);
+            } else {
+                this.searchAllItems(searchContext, heap, token, useVisited);
+            }
+        } finally {
+            if (useVisited) {
+                for (let i = 0; i < this.visitedTracker.length; i++) {
+                    this.visitedBuffer[this.visitedTracker[i]] = 0;
+                }
+                this.visitedTracker.length = 0;
+            }
         }

         const results = heap.getSorted();
@@ -1776,16 +1792,17 @@
         context: ReturnType<typeof this.prepareSearchContext>,
         heap: MinHeap<SearchResult>,
         token?: CancellationToken,
-        visited?: Uint8Array,
+        useVisited: boolean = false,
     ): void {
         for (let j = 0; j < indices.length; j++) {
             if (j % 500 === 0 && token?.isCancellationRequested) break;
             const i = indices[j];
-            if (visited) {
-                if (visited[i] === 1) {
+            if (useVisited) {
+                if (this.visitedBuffer[i] === 1) {
                     continue;
                 }
-                visited[i] = 1;
+                this.visitedBuffer[i] = 1;
+                this.visitedTracker.push(i);
             }
             this.processItemForSearch(i, context, heap);
         }
@@ -1796,12 +1813,12 @@
         context: ReturnType<typeof this.prepareSearchContext>,
         heap: MinHeap<SearchResult>,
         token?: CancellationToken,
-        visited?: Uint8Array,
+        useVisited: boolean = false,
     ): void {
         const count = context.items.length;
         for (let i = 0; i < count; i++) {
             if (i % 500 === 0 && token?.isCancellationRequested) break;
-            if (visited && visited[i] === 1) {
+            if (useVisited && this.visitedBuffer[i] === 1) {
                 continue;
             }
             this.processItemForSearch(i, context, heap);
         }
PATCH
