import { useCallback, useEffect, useRef } from 'react';
import type { UGCSubmissionStatus } from '@/services/ugc/client';
import { UGCClientError } from '@/services/ugc/client';

export type ReportTarget = { id: string; snapshotId: string };
export type ReportState = { flagged: boolean; status?: UGCSubmissionStatus };
type Task = {
    target: ReportTarget;
    desired: boolean;
    lastSynced: ReportState;
    inFlight: boolean;
    timer?: number;
};
type Config<Patch extends { status?: UGCSubmissionStatus }> = {
    scope: string;
    delay: number;
    send: (target: ReportTarget, desired: boolean) => Promise<Patch>;
    apply: (target: ReportTarget, patch: Patch) => void;
    rollback: (target: ReportTarget, state: ReportState) => void;
    conflict: (target: ReportTarget) => Promise<void>;
};

/** Delayed reporting belongs to the version clicked, including rollback and conflict recovery. */
export function useReportSync<Patch extends { status?: UGCSubmissionStatus }>(
    config: Config<Patch>,
) {
    const tasks = useRef(new Map<string, Task>());
    const latest = useRef(config);
    latest.current = config;
    useEffect(() => {
        const current = tasks.current;
        return () => {
            current.forEach((task) => {
                if (task.timer) window.clearTimeout(task.timer);
            });
            current.clear();
        };
    }, [config.scope]);
    const schedule = useCallback(function schedule(key: string) {
        const task = tasks.current.get(key);
        if (!task) return;
        if (task.timer) window.clearTimeout(task.timer);
        task.timer = window.setTimeout(() => {
            task.timer = undefined;
            if (task.inFlight) return;
            if (task.desired === task.lastSynced.flagged) {
                tasks.current.delete(key);
                return;
            }
            const sent = task.desired;
            task.inFlight = true;
            void latest.current
                .send(task.target, sent)
                .then((patch) => {
                    if (tasks.current.get(key) !== task) return;
                    task.lastSynced = { flagged: sent, status: patch.status };
                    if (task.desired === sent)
                        latest.current.apply(task.target, patch);
                })
                .catch((error: unknown) => {
                    if (tasks.current.get(key) !== task) return;
                    if (
                        error instanceof UGCClientError &&
                        error.status === 409
                    ) {
                        // Cancel the entire stale-version task, including a click made while in flight.
                        tasks.current.delete(key);
                        if (task.timer) window.clearTimeout(task.timer);
                        latest.current.rollback(task.target, task.lastSynced);
                        void latest.current
                            .conflict(task.target)
                            .catch(() => undefined);
                        return;
                    }
                    if (task.desired !== sent) return;
                    task.desired = task.lastSynced.flagged;
                    latest.current.rollback(task.target, task.lastSynced);
                })
                .finally(() => {
                    task.inFlight = false;
                    if (tasks.current.get(key) !== task) return;
                    if (task.desired !== task.lastSynced.flagged) schedule(key);
                    else tasks.current.delete(key);
                });
        }, latest.current.delay);
    }, []);
    const start = useCallback(
        (target: ReportTarget, current: ReportState, desired: boolean) => {
            if (!target.snapshotId) return;
            const key = JSON.stringify([target.id, target.snapshotId]);
            let task = tasks.current.get(key);
            if (!task) {
                task = {
                    target: { ...target },
                    desired,
                    lastSynced: current,
                    inFlight: false,
                };
                tasks.current.set(key, task);
            }
            task.desired = desired;
            schedule(key);
        },
        [schedule],
    );
    const clear = useCallback((ids: Set<string>) => {
        tasks.current.forEach((task, key) => {
            if (!ids.has(task.target.id)) return;
            if (task.timer) window.clearTimeout(task.timer);
            tasks.current.delete(key);
        });
    }, []);
    return { start, clear };
}
