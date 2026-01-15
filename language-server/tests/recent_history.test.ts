import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { ActivityTracker } from "../src/core/activity-tracker";
import { SearchEngine } from "../src/core/search-engine";
import { SearchItemType } from "../src/core/types";
import * as fs from 'fs';
import * as path from 'path';

describe("Recent History", () => {
    const tempDir = path.join(process.cwd(), ".test-temp-" + Date.now());

    beforeEach(() => {
        fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("ActivityTracker returns recent items sorted by score", () => {
        const tracker = new ActivityTracker(tempDir);

        // Simulate accesses
        // Item A: accessed now, 5 times
        for(let i=0; i<5; i++) tracker.recordAccess("itemA");

        // Item B: accessed now, 1 time
        tracker.recordAccess("itemB");

        // Item C: accessed 10 times
        for(let i=0; i<10; i++) tracker.recordAccess("itemC");

        const recent = tracker.getRecentItems(3);

        // Item C should be first (most frequent)
        // Item A second
        // Item B third
        expect(recent[0]).toBe("itemC");
        expect(recent[1]).toBe("itemA");
        expect(recent[2]).toBe("itemB");

        expect(recent.length).toBe(3);

        tracker.dispose();
    });

    test("SearchEngine resolves items by ID", () => {
        const engine = new SearchEngine();
        const items = [
            { id: "1", name: "File1", type: SearchItemType.FILE, filePath: "/path/to/File1" },
            { id: "2", name: "Class1", type: SearchItemType.CLASS, filePath: "/path/to/Class1" },
            { id: "3", name: "Method1", type: SearchItemType.METHOD, filePath: "/path/to/Method1" }
        ];

        engine.setItems(items);

        const resolved = engine.resolveItems(["2", "1"]);

        expect(resolved.length).toBe(2);
        expect(resolved[0].item.name).toBe("Class1");
        expect(resolved[1].item.name).toBe("File1");
        expect(resolved[0].score).toBe(1.0);
    });
});
