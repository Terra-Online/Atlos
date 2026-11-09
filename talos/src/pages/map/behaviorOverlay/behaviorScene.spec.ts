import { describe, expect, it } from 'vitest';
import { emptyBehaviorScene, renderRecord } from '@/pages/map/behaviorOverlay/behaviorScene';

describe('behavior scene timeline', () => {
    it('reveals unlock helpers concurrently', () => {
        const scene = emptyBehaviorScene();
        renderRecord(
            scene,
            {
                kind: 'unlock-group',
                anchorId: 'anchor',
                anchorPos: [0, 0],
                helpers: [{ pos: [1, 0] }, { pos: [0, 4] }],
            },
            'anchor',
        );

        expect(scene.lines).toHaveLength(2);
        expect(scene.lines.every((line) => line.colorRole === 'unlock')).toBe(
            true,
        );
        expect(scene.lines.map((line) => line.delay)).toEqual([0, 0]);
        expect(scene.timelineDuration).toBe(
            Math.max(...scene.lines.map((line) => line.duration)),
        );
        expect(scene.circles).toHaveLength(2);
    });

    it('advances once after a concurrent butterfly branch', () => {
        const scene = emptyBehaviorScene();
        renderRecord(
            scene,
            {
                kind: 'butterfly-path',
                anchorId: 'anchor',
                stages: [
                    {
                        mode: 'branch',
                        center: [0, 0],
                        orderedPoints: [
                            [1, 0],
                            [0, 2],
                        ],
                    },
                ],
                segments: [
                    {
                        order: 0,
                        stageIndex: 0,
                        phase: 'group-members',
                        kind: 'dash',
                        points: [
                            [0, 0],
                            [1, 0],
                        ],
                    },
                    {
                        order: 1,
                        stageIndex: 0,
                        phase: 'group-members',
                        kind: 'dash',
                        points: [
                            [0, 0],
                            [0, 2],
                        ],
                    },
                    {
                        order: 2,
                        stageIndex: 0,
                        phase: 'chest-entry',
                        kind: 'solid',
                        points: [
                            [0, 2],
                            [0, 3],
                        ],
                    },
                ],
            },
            'anchor',
        );

        expect(scene.lines[0].delay).toBe(0);
        expect(scene.lines[1].delay).toBe(0);
        expect(scene.lines[2].delay).toBe(
            Math.max(scene.lines[0].duration, scene.lines[1].duration),
        );
        expect(scene.timelineDuration).toBe(
            scene.lines[2].delay + scene.lines[2].duration,
        );
    });

    it('keeps trajectory rendering metadata intact', () => {
        const scene = emptyBehaviorScene();
        renderRecord(
            scene,
            {
                kind: 'trajectory',
                anchorId: 'anchor',
                points: [
                    [0, 0],
                    [3, 4],
                ],
                closed: true,
            },
            'anchor',
        );

        expect(scene.lines[0]).toMatchObject({
            smooth: true,
            flow: true,
            closed: true,
            totalLength: 5,
        });
    });
});
