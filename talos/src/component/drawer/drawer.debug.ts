export interface DrawerDebugLogger {
	logRender: (count: number, props: Record<string, unknown>) => void;
	logInitialMount: (initSize: number, snapIndex: number) => void;
	logSizeChange: (size: number, progress: number) => void;
	logDataSnapChange: (from: string | null, to: number, size: number) => void;
	logDataSnapRemoved: (was: string | null, size: number) => void;
	logGesture: (phase: string, data: Record<string, unknown>) => void;
	logGestureCancel: (reason: string, data?: Record<string, unknown>) => void;
	logDragStart: (startSize: number, currentSize: number) => void;
	logScrollableDetected: (element: HTMLElement) => void;
	logSizeUpdate: (prev: number, next: number, delta: number) => void;
	logSnapTarget: (from: number, to: number, index: number) => void;
	logDragComplete: () => void;
}

class NoOpLogger implements DrawerDebugLogger {
	logRender() {}
	logInitialMount() {}
	logSizeChange() {}
	logDataSnapChange() {}
	logDataSnapRemoved() {}
	logGesture() {}
	logGestureCancel() {}
	logDragStart() {}
	logScrollableDetected() {}
	logSizeUpdate() {}
	logSnapTarget() {}
	logDragComplete() {}
}

class ConsoleLogger implements DrawerDebugLogger {
	logRender(count: number, props: Record<string, unknown>) {
		console.log('[Drawer] Render', { count, props });
	}

	logInitialMount(initSize: number, snapIndex: number) {
		console.log('[Drawer] Mount', { initSize, snapIndex });
	}

	logSizeChange(size: number, progress: number) {
		console.log('[Drawer] Size', { size, progress });
	}

	logDataSnapChange(from: string | null, to: number, size: number) {
		console.log('[Drawer] Snap', { from, to, size });
	}

	logDataSnapRemoved(was: string | null, size: number) {
		console.log('[Drawer] Snap removed', { was, size });
	}

	logGesture(phase: string, data: Record<string, unknown>) {
		console.log(`[Drawer Gesture] ${phase}`, data);
	}

	logGestureCancel(reason: string, data?: Record<string, unknown>) {
		console.log('[Drawer Gesture] Cancel:', reason, data);
	}

	logDragStart(startSize: number, currentSize: number) {
		console.log('[Drawer Gesture] Start', { startSize, currentSize });
	}

	logScrollableDetected(element: HTMLElement) {
		console.log('[Drawer Gesture] Scrollable', {
			tag: element.tagName,
			scrollTop: element.scrollTop,
			scrollHeight: element.scrollHeight,
			clientHeight: element.clientHeight,
		});
	}

	logSizeUpdate(prev: number, next: number, delta: number) {
		if (Math.abs(next - prev) > 1) {
			console.log('[Drawer Gesture] Update', { prev, next, delta });
		}
	}

	logSnapTarget(from: number, to: number, index: number) {
		console.log('[Drawer Gesture] Snap to', { from, to, index });
	}

	logDragComplete() {
		console.log('[Drawer Gesture] Complete');
	}
}

export function createLogger(enabled: boolean): DrawerDebugLogger {
	return enabled ? new ConsoleLogger() : new NoOpLogger();
}