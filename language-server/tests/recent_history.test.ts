import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { ActivityTracker } from "../src/core/activity-tracker";
import { SearchEngine } from "../src/core/search-engine";
import { SearchItemType } from "../src/core/types";
import * as fs from 'node:fs';
import * as path from 'node:path';

describe("Recent History", () => {
    const tempDir = path.join(process.cwd(), ".test-temp-" + Date.now());

    beforeEach(() => {
        fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('ActivityTracker returns recent items sorted by score', async () => {
        const tracker = new ActivityTracker(tempDir);
        await tracker.waitForLoaded();

        tracker.recordAccess({ id: 'itemA', name: 'A', type: SearchItemType.FILE, filePath: 'a.ts' });
        tracker.recordAccess({ id: 'itemB', name: 'B', type: SearchItemType.FILE, filePath: 'b.ts' });
        tracker.recordAccess({ id: 'itemC', name: 'C', type: SearchItemType.FILE, filePath: 'c.ts' });
        tracker.recordAccess({ id: 'itemC', name: 'C', type: SearchItemType.FILE, filePath: 'c.ts' });

        await new Promise((r) => setTimeout(r, 10));

        const recent = tracker.getRecentItemIds(3);

        expect(recent[0]).toBe('itemC');
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
