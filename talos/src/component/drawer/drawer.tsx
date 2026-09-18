import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMotionValue, animate } from 'motion/react';
import { useDrag } from '@use-gesture/react';
import { createLogger } from './drawer.debug';
import styles from './drawer.module.scss';

type Side = 'top' | 'bottom' | 'left' | 'right';
export type DrawerLength = number | `${number}px` | `${number}rem`;

const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, label, [role="button"], [role="link"], [contenteditable="true"]';
const FILTER_ICON_SELECTOR = '[class*="filterIcon"]';
const DRAG_IGNORE_SELECTOR = '[data-drawer-drag-ignore="true"]';

export interface DrawerProps {
	side?: Side;
	initialSize?: DrawerLength;
	snap?: DrawerLength[];
	snapThreshold?: number | number[];
	handleSize?: DrawerLength;
	dragDisabled?: boolean;
	debug?: boolean;
	onProgressChange?: (progress: number) => void;
	onSnapChange?: (index: number) => void;
	className?: string;
	handleClassName?: string;
	contentClassName?: string;
	backdropClassName?: string;
	style?: React.CSSProperties;
	children?: React.ReactNode;
	fullWidth?: boolean;
	snapToIndex?: number | null;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const getRootRemPx = () => {
	if (typeof document === 'undefined') return 16;
	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
};

const resolveLength = (value: DrawerLength, remPx: number): number => {
	if (typeof value === 'number') return value;
	const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/.exec(value.trim());
	if (!match) return 0;
	const amount = Number.parseFloat(match[1]);
	return match[2] === 'rem' ? amount * remPx : amount;
};

const useRootRemPx = (enabled: boolean) => {
	const [remPx, setRemPx] = React.useState(getRootRemPx);

	useEffect(() => {
		if (!enabled) return;
		const probe = document.createElement('span');
		probe.setAttribute('aria-hidden', 'true');
		probe.style.cssText = 'position:absolute;width:1rem;height:1rem;visibility:hidden;pointer-events:none;';
		document.documentElement.appendChild(probe);

		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				setRemPx(probe.getBoundingClientRect().height || 16);
			});
		};
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
		observer?.observe(probe);
		const visualViewport = window.visualViewport;
		window.addEventListener('resize', update);
		visualViewport?.addEventListener('resize', update);
		update();

		return () => {
			cancelAnimationFrame(frame);
			observer?.disconnect();
			window.removeEventListener('resize', update);
			visualViewport?.removeEventListener('resize', update);
			probe.remove();
		};
	}, [enabled]);

	return remPx;
};

// Normalize and deduplicate snap points
const normalizeSnaps = (snap: number[]) => {
	const input = snap.length ? snap : [0, 300];
	const maxVal = Math.max(...input);
	return Array.from(new Set(input.map(v => clamp(v, 0, maxVal)))).sort((a, b) => a - b);
};

// Convert threshold percentage to 0-1 range
const normalizeThreshold = (threshold: number | number[], snapsCount: number): number[] => {
	const toPct = (v: number) => clamp(v, 0, 100) / 100;
	if (Array.isArray(threshold)) {
		const last = threshold[threshold.length - 1] ?? 50;
		return Array.from({ length: snapsCount }, (_, i) => toPct(threshold[i] ?? last));
	}
	return Array.from({ length: snapsCount }, () => toPct(typeof threshold === 'number' ? threshold : 50));
};

// Find target snap point based on current position and thresholds
const findSnapTarget = (
	cur: number,
	snaps: number[],
	thresholds: number[]
): { target: number; index: number } | null => {
	for (let i = 0; i < snaps.length; i++) {
		const s = snaps[i];
		const pct = thresholds[i];
		
		// Check left threshold (from previous snap)
		if (i > 0) {
			const leftWidth = s - snaps[i - 1];
			if (cur >= s - pct * leftWidth && cur <= s) {
				return { target: s, index: i };
			}
		}
		
		// Check right threshold (to next snap)
		if (i < snaps.length - 1) {
			const rightWidth = snaps[i + 1] - s;
			if (cur >= s && cur <= s + pct * rightWidth) {
				return { target: s, index: i };
			}
		}
	}
	return null;
};

const isVerticallyScrollable = (element: HTMLElement): boolean => {
	const { overflowY } = getComputedStyle(element);
	return (
		(overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
		&& element.scrollHeight > element.clientHeight + 1
	);
};

const canScrollInDirection = (element: HTMLElement, movementY: number): boolean => {
	if (movementY > 0) return element.scrollTop > 1;
	if (movementY < 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
	return false;
};

// Find scrollable ancestors from the gesture target outward to the drawer container.
const findScrollables = (el: Element | null, container: HTMLElement | null): HTMLElement[] => {
	const scrollables: HTMLElement[] = [];
	let cur = el;
	while (cur && container && cur !== container) {
		if (cur instanceof HTMLElement) {
			if (isVerticallyScrollable(cur)) {
				scrollables.push(cur);
			}
		}
		cur = cur.parentElement;
	}
	return scrollables;
};

export const Drawer: React.FC<DrawerProps> = ({
	side = 'bottom',
	initialSize = 0,
	snap = [0, 300],
	snapThreshold = [50, 50],
	handleSize = 24,
	dragDisabled = false,
	debug = false,
	onProgressChange,
	onSnapChange,
	className,
	handleClassName,
	contentClassName,
	backdropClassName,
	style,
	children,
	fullWidth = true,
	snapToIndex = null,
}) => {
	const remPx = useRootRemPx(
		(typeof initialSize === 'string' && initialSize.endsWith('rem'))
		|| snap.some((value) => typeof value === 'string' && value.endsWith('rem'))
		|| (typeof handleSize === 'string' && handleSize.endsWith('rem')),
	);
	const logger = useMemo(() => createLogger(debug), [debug]);
	const renderCount = useRef(0);
	
	// Memoize normalized values
	const snapsNormalized = useMemo(
		() => normalizeSnaps(snap.map((value) => resolveLength(value, remPx))),
		[snap, remPx],
	);
	const thresholdsPct = useMemo(
		() => normalizeThreshold(snapThreshold, snapsNormalized.length),
		[snapThreshold, snapsNormalized.length]
	);
	
	const minSnap = snapsNormalized[0] ?? 0;
	const maxSnap = snapsNormalized[snapsNormalized.length - 1] ?? 0;
	const safeRange = Math.max(1, maxSnap - minSnap);
	const initSize = clamp(resolveLength(initialSize, remPx), minSnap, maxSnap);
	const resolvedHandleSize = resolveLength(handleSize, remPx);
	
	// Motion values
	const size = useMotionValue(initSize);
	const progress = useMotionValue((initSize - minSnap) / safeRange);
	
	// Refs
	const containerRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLDivElement>(null);
	const dragStartSizeRef = useRef(initSize);
	const lastSizeRef = useRef(initSize);
	const isDraggingRef = useRef(false);
	const isGestureRejectedRef = useRef(false);
	const scrollElsRef = useRef<HTMLElement[]>([]);
	const lastSnapCommandRef = useRef<number | null | undefined>(undefined);
	const previousSnapsRef = useRef(snapsNormalized);
	
	// Debug: track renders
	logger.logRender(++renderCount.current, { side, initialSize, snapToIndex, handleSize, fullWidth });
	
	// Update progress and CSS vars when size changes
	useEffect(() => {
		const unsub = size.on('change', (v) => {
			const p = clamp((v - minSnap) / safeRange, 0, 1);
			progress.set(p);
			onProgressChange?.(p);
			lastSizeRef.current = v;
			
			const container = containerRef.current;
			if (!container) return;
			
			container.style.setProperty('--drawer-size', `${v}px`);
			container.style.setProperty('--drawer-progress', `${p}`);
			
			// Update data-snap attribute
			const idx = snapsNormalized.findIndex(s => Math.abs(s - v) <= 0.5);
			const prevSnap = container.getAttribute('data-snap');
			
			if (idx >= 0) {
				const newSnap = String(idx);
				if (prevSnap !== newSnap) {
					container.setAttribute('data-snap', newSnap);
					onSnapChange?.(idx);
					logger.logDataSnapChange(prevSnap, idx, v);
				}
			} else if (prevSnap !== null) {
				container.removeAttribute('data-snap');
				logger.logDataSnapRemoved(prevSnap, v);
			}
			
			logger.logSizeChange(v, p);
		});
		return () => unsub();
	}, [onProgressChange, onSnapChange, size, progress, safeRange, minSnap, snapsNormalized, logger]);
	
	// Initialize on mount only
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		
		const p = (initSize - minSnap) / safeRange;
		container.style.setProperty('--drawer-size', `${initSize}px`);
		container.style.setProperty('--drawer-progress', `${p}`);
		
		const idx = snapsNormalized.findIndex(s => Math.abs(s - initSize) <= 0.5);
		if (idx >= 0) container.setAttribute('data-snap', String(idx));
		
		logger.logInitialMount(initSize, idx);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	
	// Imperative snap via prop
	useEffect(() => {
		// snapToIndex is an imperative command, not continuously controlled state.
		// Re-target the active snap when its pixel size changes with browser zoom.
		const previousSnaps = previousSnapsRef.current;
		const snapDimensionsChanged = previousSnaps !== snapsNormalized;
		const idx = snapToIndex == null ? -1 : Math.trunc(snapToIndex);
		const activeIndex = idx >= 0
			? idx
			: previousSnaps.reduce((best, value, index) => (
				Math.abs(value - size.get()) < Math.abs(previousSnaps[best] - size.get()) ? index : best
			), 0);
		const previousTarget = previousSnaps[activeIndex];
		const preservingActiveSnap = snapDimensionsChanged
			&& previousTarget != null
			&& Math.abs(size.get() - previousTarget) <= 0.5;

		if (Object.is(lastSnapCommandRef.current, snapToIndex) && !preservingActiveSnap) {
			previousSnapsRef.current = snapsNormalized;
			return;
		}
		lastSnapCommandRef.current = snapToIndex;
		previousSnapsRef.current = snapsNormalized;
		if (isDraggingRef.current) return;
		if (snapToIndex == null && !preservingActiveSnap) return;
		const target = snapsNormalized[idx >= 0 ? idx : activeIndex];
		if (target == null || Math.abs(size.get() - target) <= 0.5) return;
		animate(size, target, { duration: 0.25 });
	}, [snapToIndex, snapsNormalized, size]);
	
	// Container positioning
	const containerStyle = useMemo<React.CSSProperties>(() => {
		const common = {
			'--handle-size': `${resolvedHandleSize}px`,
			'--drawer-size': `${initSize}px`,
			'--drawer-progress': `${(initSize - minSnap) / safeRange}`,
		} as React.CSSProperties;
		
		const posMap = {
			bottom: fullWidth ? { left: 0, right: 0, bottom: 0 } : { bottom: 0, left: '50%', transform: 'translateX(-50%)' },
			top: fullWidth ? { left: 0, right: 0, top: 0 } : { top: 0, left: '50%', transform: 'translateX(-50%)' },
			left: fullWidth ? { top: 0, bottom: 0, left: 0 } : { top: '50%', left: 0, transform: 'translateY(-50%)' },
			right: fullWidth ? { top: 0, bottom: 0, right: 0 } : { top: '50%', right: 0, transform: 'translateY(-50%)' },
		};
		
		return { ...common, ...posMap[side] };
	}, [resolvedHandleSize, initSize, minSnap, safeRange, side, fullWidth]);
	
	// Gesture handler
	const axis: 'x' | 'y' = side === 'left' || side === 'right' ? 'x' : 'y';
	const onDrag = useCallback((state: {
		first: boolean;
		last: boolean;
		movement: [number, number];
		cancel: () => void;
		event: Event;
		intentional?: boolean;
	}) => {
		const { first, last, movement, cancel, event, intentional } = state;
		const [mx, my] = movement;
		if (first) isGestureRejectedRef.current = false;

		if (dragDisabled) {
			if (first) {
				isGestureRejectedRef.current = true;
				cancel();
			}
			return;
		}

		// cancel() synchronously emits a final callback. Keep the whole rejected
		// sequence inert so that callback cannot reuse a stale dragStartSize.
		if (isGestureRejectedRef.current) return;
		
		if (first || last) {
			logger.logGesture(first ? 'START' : 'END', {
				intentional,
				movement: { mx, my },
				size: size.get(),
			});
		}
		
		// First touch: initialize and check cancellation conditions
		if (first) {
			const target = event.target as Element | null;
			
			if (target?.closest(INTERACTIVE_SELECTOR)) {
				logger.logGestureCancel('interactive element');
				isGestureRejectedRef.current = true;
				cancel();
				return;
			}

			if (target?.closest(DRAG_IGNORE_SELECTOR)) {
				logger.logGestureCancel('drag ignore region');
				isGestureRejectedRef.current = true;
				cancel();
				return;
			}

			if (target?.closest(FILTER_ICON_SELECTOR)) {
				logger.logGestureCancel('filterIcon drag');
				isGestureRejectedRef.current = true;
				cancel();
				return;
			}
			
			dragStartSizeRef.current = size.get();
			isDraggingRef.current = false;
			scrollElsRef.current = findScrollables(target, containerRef.current);
			
			if (scrollElsRef.current.length > 0) logger.logScrollableDetected(scrollElsRef.current[0]);
		}
		
		// Not intentional yet: wait for threshold
		if (!intentional) {
			if (last && handleRef.current) {
				handleRef.current.removeAttribute('data-dragging');
			}
			return;
		}
		
		// Check scroll conflict
		const scrollEls = scrollElsRef.current;
		if (scrollEls.length > 0 && axis === 'y') {
			const scrollOwner = scrollEls.find((scrollEl) => canScrollInDirection(scrollEl, my));
			if (scrollOwner) {
				logger.logGestureCancel('content scroll priority');
				isGestureRejectedRef.current = true;
				cancel();
				return;
			}
		}
		
		// Start dragging state
		if (!isDraggingRef.current) {
			isDraggingRef.current = true;
			if (handleRef.current) handleRef.current.setAttribute('data-dragging', 'true');
			if (containerRef.current) {
				containerRef.current.style.touchAction = 'none';
				(containerRef.current.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = 'contain';
			}
			logger.logDragStart(dragStartSizeRef.current, size.get());
		}
		
		// Calculate new size
		const deltaMap = { bottom: -my, top: my, left: mx, right: -mx };
		const delta = deltaMap[side];
		const next = clamp(dragStartSizeRef.current + delta, minSnap, maxSnap);
		
		if (Math.abs(next - lastSizeRef.current) > 0.01) {
			size.set(next);
			logger.logSizeUpdate(lastSizeRef.current, next, delta);
		}
		
		event.preventDefault?.();
		
		// Drag end: snap to nearest point
		if (last) {
			if (!isDraggingRef.current) return;
			
			const cur = size.get();
			const snapResult = findSnapTarget(cur, snapsNormalized, thresholdsPct);
			
			if (snapResult && Math.abs(snapResult.target - cur) > 0.5) {
				animate(size, snapResult.target, { duration: 0.25 });
				logger.logSnapTarget(cur, snapResult.target, snapResult.index);
			}
			
			isDraggingRef.current = false;
			if (handleRef.current) handleRef.current.removeAttribute('data-dragging');
			if (containerRef.current) {
				containerRef.current.style.removeProperty('touch-action');
				(containerRef.current.style as CSSStyleDeclaration & { overscrollBehavior?: string }).overscrollBehavior = '';
			}
			logger.logDragComplete();
		}
	}, [axis, side, size, minSnap, maxSnap, snapsNormalized, thresholdsPct, logger, dragDisabled]);
	
	const dragOptions = useMemo(() => ({
		target: containerRef,
		axis,
		filterTaps: true,
		threshold: 8,
		pointer: { touch: true },
		eventOptions: { passive: false },
	}), [axis]);
	
	useDrag(onDrag, dragOptions);
	
	// Handle click to cycle snaps
	const onHandleClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		if (dragDisabled) return;
		if (isDraggingRef.current) return;

		const currentSize = size.get();
		// Find closest snap index
		const closestIndex = snapsNormalized.reduce((bestIdx, s, i) => {
			return Math.abs(s - currentSize) < Math.abs(snapsNormalized[bestIdx] - currentSize) ? i : bestIdx;
		}, 0);

		const nextIndex = (closestIndex + 1) % snapsNormalized.length;
		const target = snapsNormalized[nextIndex];

		animate(size, target, { duration: 0.25 });
		logger.logSnapTarget(currentSize, target, nextIndex);
	}, [size, snapsNormalized, logger, dragDisabled]);

	// Handle class
	const handleClass = useMemo(() => ({
		bottom: styles.handleBottom,
		top: styles.handleTop,
		left: styles.handleLeft,
		right: styles.handleRight,
	}[side]), [side]);
	
	return (
		<div ref={containerRef} className={`${styles.drawerContainer} ${className ?? ''}`} style={{ ...containerStyle, ...style }}>
			<div className={`${styles.content} ${contentClassName ?? ''}`}>{children}</div>
			<div
				ref={handleRef}
				className={`${styles.handle} ${handleClass} ${handleClassName ?? ''}`}
				role="separator"
				aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
				aria-label="Drawer drag handle"
				aria-disabled={dragDisabled}
				onClick={onHandleClick}
			/>
			<div className={`${styles.backdrop} ${backdropClassName ?? ''}`} />
		</div>
	);
};

export default React.memo(Drawer);
