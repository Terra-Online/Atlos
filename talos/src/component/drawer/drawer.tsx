import React, { useEffect, useMemo, useRef } from 'react';
import { useMotionValue, animate } from 'motion/react';
import styles from './drawer.module.scss';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface DrawerProps {
	side?: Side; // which edge to attach
	/**
	 * Initial opened size in px; will be clamped to [0, maxSnap].
	 */
	initialSize?: number; // px
	/**
	 * Snap points in absolute px from 0 to maxSize (inclusive). Example: [0, 200, 400, 600, 1000].
	 * Defaults to [0, 300]. Values will be clamped to [0, maxSize], de-duplicated and sorted.
	 */
	snap?: number[];
	/**
	 * Snap thresholds as percentages per snap point. Each value applies to both sides of a snap point
	 * and is measured as a percentage of the neighboring interval width. Example for snaps [0,200,400]:
	 * thresholds [50,30,50] means:
	 * - near 0 within 50% of [0,200], snap to 0
	 * - near 200 within 30% of [0,200] on the left OR within 30% of [200,400] on the right, snap to 200
	 * - near 400 within 50% of [200,400] on the left, snap to 400
	 * If provided as a single number, it is used for all snap points. Defaults to [50, 50].
	 */
	snapThreshold?: number | number[];
	handleSize?: number; // px for hit area
	debug?: boolean; // print debug logs

	onProgressChange?: (progress: number) => void;
	className?: string; // container class for custom styling
	handleClassName?: string; // handle class for custom styling
	contentClassName?: string; // content class for custom styling
	backdropClassName?: string; // backdrop class for custom styling
	style?: React.CSSProperties;
	children?: React.ReactNode;
	/**
	 * When true (default), the drawer stretches to the container edges (left/right or top/bottom).
	 * When false, positioning leaves horizontal freedom for custom width and centering (e.g., mobile width calc).
	 */
	fullWidth?: boolean;
}

function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n));
}

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
}) => {
	// Normalize snaps and compute min/max/range
	const snapsNormalized = useMemo(() => {
		const input = (snap ?? [0, 300]).slice();
		if (input.length === 0) input.push(0);
		const maxVal = Math.max(...input);
		const dedup = Array.from(new Set(input.map((v) => clamp(v, 0, maxVal))));
		dedup.sort((a, b) => a - b);
		return dedup;
	}, [snap]);
	const minSnap = snapsNormalized[0] ?? 0;
	const maxSnap = snapsNormalized[snapsNormalized.length - 1] ?? 0;
	const range = maxSnap - minSnap;
	const safeRange = range > 0 ? range : 1; // avoid divide-by-zero

	const initSize = clamp(initialSize, minSnap, maxSnap);
	const size = useMotionValue(initSize);
	const progress = useMotionValue(clamp((initSize - minSnap) / safeRange, 0, 1));
	const startSizeRef = useRef(size.get());
	const startPosRef = useRef<{ x: number; y: number } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLDivElement>(null);
	const isDraggingRef = useRef(false);

	// Update progress and inject CSS vars when size changes
	useEffect(() => {
		const unsub = size.on('change', (v) => {
			const p = clamp((v - minSnap) / safeRange, 0, 1);
			progress.set(p);
			if (debug) console.log('[Drawer] size/progress', { v, p });
			onProgressChange?.(p);
			
			// Inject CSS variables for animations
			if (containerRef.current) {
				containerRef.current.style.setProperty('--drawer-size', `${v}px`);
				containerRef.current.style.setProperty('--drawer-progress', `${p}`);
				// set data-snap index when exactly at a snap (with tolerance)
				const idx = snapsNormalized.findIndex((s) => Math.abs(s - v) <= 0.5);
				if (idx >= 0) {
					containerRef.current.setAttribute('data-snap', String(idx));
				} else {
					containerRef.current.removeAttribute('data-snap');
				}
				if (debug) console.log('[Drawer] CSS vars updated', { size: v, progress: p });
			}
		});
		return () => unsub();
	}, [debug, onProgressChange, size, progress, safeRange, minSnap, snapsNormalized]);

	// Decide absolute positioning style per side
	const containerStyle = useMemo<React.CSSProperties>(() => {
		const common: React.CSSProperties = {
			// CSS var for handle area height/width
			['--handle-size' as string]: `${handleSize}px`,
			// Initial values; will be updated by size.on('change')
			['--drawer-size' as string]: `${initSize}px`,
			['--drawer-progress' as string]: `${clamp((initSize - minSnap) / safeRange, 0, 1)}`,
		};
		if (side === 'bottom') {
			// By default stretch to full width. If not fullWidth, allow custom width/centering.
			return fullWidth
				? { ...common, left: 0, right: 0, bottom: 0 }
				: { ...common, bottom: 0, left: '50%', transform: 'translateX(-50%)' };
		}
		if (side === 'top') {
			return fullWidth
				? { ...common, left: 0, right: 0, top: 0 }
				: { ...common, top: 0, left: '50%', transform: 'translateX(-50%)' };
		}
		if (side === 'left') {
			return fullWidth
				? { ...common, top: 0, bottom: 0, left: 0 }
				: { ...common, top: '50%', left: 0, transform: 'translateY(-50%)' };
		}
		return fullWidth
			? { ...common, top: 0, bottom: 0, right: 0 }
			: { ...common, top: '50%', right: 0, transform: 'translateY(-50%)' };
	}, [handleSize, initSize, minSnap, safeRange, side, fullWidth]);

	const onPointerDown = (e: React.PointerEvent) => {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		startSizeRef.current = size.get();
		startPosRef.current = { x: e.clientX, y: e.clientY };
		
		// Set dragging state
		isDraggingRef.current = true;
		if (handleRef.current) {
			handleRef.current.setAttribute('data-dragging', 'true');
		}

		if (debug) console.log('[Drawer] pointerdown', { side, startSize: startSizeRef.current, startPos: startPosRef.current });
	};

	const onPointerMove = (e: React.PointerEvent) => {
		if (!startPosRef.current) return;
		const dx = e.clientX - startPosRef.current.x;
		const dy = e.clientY - startPosRef.current.y;
		let delta = 0;
		switch (side) {
			case 'bottom':
				delta = -dy; // drag up opens
				break;
			case 'top':
				delta = dy; // drag down opens
				break;
			case 'left':
				delta = dx; // drag right opens
				break;
			case 'right':
				delta = -dx; // drag left opens
				break;
		}
		const next = clamp(startSizeRef.current + delta, minSnap, maxSnap);
		size.set(next);
		if (debug) {
			const progress = clamp((next - minSnap) / safeRange, 0, 1);
			console.log('[Drawer] move', { dx, dy, delta, next, progress });
		}
	};

	const onPointerUp = () => {
		startPosRef.current = null;
		
		// Clear dragging state
		isDraggingRef.current = false;
		if (handleRef.current) {
			handleRef.current.removeAttribute('data-dragging');
		}
		
		// snapping using snap points and per-point thresholds
		const cur = size.get();
		// snaps are pre-normalized
		const snaps = snapsNormalized;
		// resolve thresholds per snap point
		const toPct = (v: number) => clamp(v, 0, 100);
		const thresholds: number[] = Array.isArray(snapThreshold)
			? snaps.map((_, i) => toPct(snapThreshold[i] ?? (snapThreshold.length ? snapThreshold[snapThreshold.length - 1] : 50)))
			: snaps.map(() => toPct(typeof snapThreshold === 'number' ? snapThreshold : 50));
		let target: number | null = null;
		let targetIndex: number | null = null;
		for (let i = 0; i < snaps.length; i++) {
			const s = snaps[i];
			const pct = thresholds[i] / 100;
			// left band for s (towards snaps[i-1])
			if (i > 0) {
				const leftWidth = s - snaps[i - 1];
				const leftStart = s - pct * leftWidth;
				if (cur >= leftStart && cur <= s) {
					target = s;
					targetIndex = i;
					break;
				}
			}
			// right band for s (towards snaps[i+1])
			if (i < snaps.length - 1) {
				const rightWidth = snaps[i + 1] - s;
				const rightEnd = s + pct * rightWidth;
				if (cur >= s && cur <= rightEnd) {
					target = s;
					targetIndex = i;
					break;
				}
			}
		}
		if (debug) console.log('[Drawer] pointerup', { cur, snaps, thresholds, target, targetIndex });
		if (target != null && Math.abs(target - cur) > 0.5) {
			animate(size, target, { duration: 0.25 });
			if (containerRef.current && targetIndex != null) {
				containerRef.current.setAttribute('data-snap', String(targetIndex));
			}
		}
	};

	// Decide handle position class
	const handleClass = useMemo(() => {
		switch (side) {
			case 'bottom':
				return styles.handleBottom;
			case 'top':
				return styles.handleTop;
			case 'left':
				return styles.handleLeft;
			case 'right':
			default:
				return styles.handleRight;
		}
	}, [side]);

	return (
		<div ref={containerRef} className={`${styles.drawerContainer} ${className ?? ''}`} style={{ ...containerStyle, ...style }}>
			<div className={`${styles.content} ${contentClassName ?? ''}`}>{children}</div>
			<div
				ref={handleRef}
				className={`${styles.handle} ${handleClass} ${handleClassName ?? ''}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				role="separator"
				aria-orientation={side === 'left' || side === 'right' ? 'vertical' : 'horizontal'}
				aria-label="Drawer drag handle"
			/>
            <div className={`${styles.backdrop} ${backdropClassName ?? ''}`} />
		</div>
	);
};

export default Drawer;