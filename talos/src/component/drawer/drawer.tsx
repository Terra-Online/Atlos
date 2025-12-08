import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMotionValue, animate } from 'motion/react';
import { useDrag } from '@use-gesture/react';
import { createLogger } from './drawer.debug';
import styles from './drawer.module.scss';

type Side = 'top' | 'bottom' | 'left' | 'right';

const INTERACTIVE_SELECTOR = 'button, a, select, label, [role="button"], [role="link"], [contenteditable="true"]';
const FILTER_ICON_SELECTOR = '[class*="filterIcon"]';

export interface DrawerProps {
	side?: Side;
	initialSize?: number;
	snap?: number[];
	snapThreshold?: number | number[];
	handleSize?: number;
	debug?: boolean;
	onProgressChange?: (progress: number) => void;
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

// Find scrollable ancestor
const findScrollable = (el: Element | null, container: HTMLElement | null): HTMLElement | null => {
	let cur = el;
	while (cur && container && cur !== container) {
		if (cur instanceof HTMLElement) {
			const { overflowY } = getComputedStyle(cur);
			if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && 
			    cur.scrollHeight > cur.clientHeight + 1) {
				return cur;
			}
		}
		cur = cur.parentElement;
	}
	return null;
};

export const Drawer: React.FC<DrawerProps> = ({
	side = 'bottom',
	initialSize = 0,
	snap = [0, 300],
	snapThreshold = [50, 50],
	handleSize = 24,
	debug = false,
	onProgressChange,
	className,
	handleClassName,
	contentClassName,
	backdropClassName,
	style,
	children,
	fullWidth = true,
	snapToIndex = null,
}) => {
	const logger = useMemo(() => createLogger(debug), [debug]);
	const renderCount = useRef(0);
	
	// Memoize normalized values
	const snapsNormalized = useMemo(() => normalizeSnaps(snap), [snap]);
	const thresholdsPct = useMemo(
		() => normalizeThreshold(snapThreshold, snapsNormalized.length),
		[snapThreshold, snapsNormalized.length]
	);
	
	const minSnap = snapsNormalized[0] ?? 0;
	const maxSnap = snapsNormalized[snapsNormalized.length - 1] ?? 0;
	const safeRange = Math.max(1, maxSnap - minSnap);
	const initSize = clamp(initialSize, minSnap, maxSnap);
	
	// Motion values
	const size = useMotionValue(initSize);
	const progress = useMotionValue((initSize - minSnap) / safeRange);
	
	// Refs
	const containerRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLDivElement>(null);
	const dragStartSizeRef = useRef(initSize);
	const lastSizeRef = useRef(initSize);
	const isDraggingRef = useRef(false);
	const scrollElRef = useRef<HTMLElement | null>(null);
	
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
					logger.logDataSnapChange(prevSnap, idx, v);
				}
			} else if (prevSnap !== null) {
				container.removeAttribute('data-snap');
				logger.logDataSnapRemoved(prevSnap, v);
			}
			
			logger.logSizeChange(v, p);
		});
		return () => unsub();
	}, [onProgressChange, size, progress, safeRange, minSnap, snapsNormalized, logger]);
	
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
		if (snapToIndex == null) return;
		const idx = Math.trunc(snapToIndex);
		const target = snapsNormalized[idx];
		if (target == null || Math.abs(size.get() - target) <= 0.5) return;
		animate(size, target, { duration: 0.25 });
	}, [snapToIndex, snapsNormalized, size]);
	
	// Container positioning
	const containerStyle = useMemo<React.CSSProperties>(() => {
		const common = {
			'--handle-size': `${handleSize}px`,
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
	}, [handleSize, initSize, minSnap, safeRange, side, fullWidth]);
	
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
		
		logger.logGesture(first ? 'START' : last ? 'END' : 'MOVE', {
			intentional,
			movement: { mx, my },
			size: size.get(),
		});
		
		// First touch: initialize and check cancellation conditions
		if (first) {
			const target = event.target as Element | null;
			
			if (target?.closest(INTERACTIVE_SELECTOR)) {
				logger.logGestureCancel('interactive element');
				cancel();
				return;
			}
			
			if (target?.closest(FILTER_ICON_SELECTOR)) {
				logger.logGestureCancel('filterIcon drag');
				cancel();
				return;
			}
			
			dragStartSizeRef.current = size.get();
			isDraggingRef.current = false;
			scrollElRef.current = findScrollable(target, containerRef.current);
			
			if (scrollElRef.current) logger.logScrollableDetected(scrollElRef.current);
		}
		
		// Not intentional yet: wait for threshold
		if (!intentional) {
			if (last && handleRef.current) {
				handleRef.current.removeAttribute('data-dragging');
			}
			return;
		}
		
		// Check scroll conflict
		const scrollEl = scrollElRef.current;
		if (scrollEl && axis === 'y') {
			const atTop = scrollEl.scrollTop <= 1;
			const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
			
			if ((my > 0 && !atTop) || (my < 0 && !atBottom)) {
				logger.logGestureCancel('content scroll priority');
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
				if (containerRef.current) {
					containerRef.current.setAttribute('data-snap', String(snapResult.index));
				}
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
	}, [axis, side, size, minSnap, maxSnap, snapsNormalized, thresholdsPct, logger]);
	
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
	}, [size, snapsNormalized, logger]);

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
				onClick={onHandleClick}
			/>
			<div className={`${styles.backdrop} ${backdropClassName ?? ''}`} />
		</div>
	);
};

export default Drawer;