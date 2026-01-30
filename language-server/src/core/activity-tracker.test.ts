import { describe, expect, it, beforeEach } from 'bun:test';
import { ActivityTracker } from './activity-tracker';
import { SearchItemType } from './types';

describe('ActivityTracker', () => {
    let tracker: ActivityTracker;
    const mockStorage = {
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        },
    };

    beforeEach(() => {
        tracker = new ActivityTracker(mockStorage);
    });

    it('should calculate scores correctly on single access', () => {
        const item = {
            id: 'test-1',
            name: 'test.ts',
            type: SearchItemType.FILE,
            filePath: '/test.ts',
        };

        tracker.recordAccess(item);
        const score = tracker.getActivityScore(item.id);

        // Initial score with 1 access and recent access should be high.
        // Recency = 1.0 (approx), Frequency = 1/1 = 1.0.
        // Score = 0.6 * 1.0 + 0.4 * 1.0 = 1.0.
        expect(score).toBeGreaterThan(0.9);
    });

    it('should update relative scores when multiple items exist', () => {
        const item1 = { id: '1', name: '1', type: SearchItemType.FILE, filePath: '/1' };
        const item2 = { id: '2', name: '2', type: SearchItemType.FILE, filePath: '/2' };

        // Item 1 accessed twice
        tracker.recordAccess(item1);
        tracker.recordAccess(item1);

        // Item 2 accessed once
        tracker.recordAccess(item2);

        const score1 = tracker.getActivityScore('1');
        const score2 = tracker.getActivityScore('2');

        // Max access = 2.
        // Item 1: Recency ~1, Freq = 2/2 = 1. Score ~ 1.0.
        // Item 2: Recency ~1, Freq = 1/2 = 0.5. Score ~ 0.6 + 0.2 = 0.8.

        expect(score1).toBeGreaterThan(score2);
        expect(score2).toBeGreaterThan(0);
    });
});
