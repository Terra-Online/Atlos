import React, { useEffect, useMemo, useRef } from 'react';
import { useMotionValue, animate } from 'motion/react';
import styles from './drawer.module.scss';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface DrawerProps {
	side?: Side; // which edge to attach
	maxSize: number; // px
	initialSize?: number; // px
	snapThreshold?: number; // px or [0,1] if <=1 treat as ratio of max
	handleSize?: number; // px for hit area
	debug?: boolean; // print debug logs

	onProgressChange?: (progress: number) => void;
	className?: string; // container class
	handleClassName?: string; // handle class for custom styling
	contentClassName?: string; // content class for custom styling
	backdropClassName?: string; // backdrop class for custom styling
	style?: React.CSSProperties;
	children?: React.ReactNode;
}

function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n));
}

export const Drawer: React.FC<DrawerProps> = ({
	side = 'bottom',
	maxSize,
	initialSize = 0,
	snapThreshold = 0.12,
	handleSize = 16,
	debug = false,
	onProgressChange,
	className,
	handleClassName,
	contentClassName,
	backdropClassName,
	style,
	children,
}) => {
	const size = useMotionValue(clamp(initialSize, 0, maxSize));
	const progress = useMotionValue(clamp(initialSize / maxSize, 0, 1));
	const startSizeRef = useRef(size.get());
	const startPosRef = useRef<{ x: number; y: number } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLDivElement>(null);
	const isDraggingRef = useRef(false);

	// Update progress and inject CSS vars when size changes
	useEffect(() => {
		const unsub = size.on('change', (v) => {
			const p = clamp(v / maxSize, 0, 1);
			progress.set(p);
			if (debug) console.log('[Drawer] size/progress', { v, p });
			onProgressChange?.(p);
			
			// Inject CSS variables for animations
			if (containerRef.current) {
				containerRef.current.style.setProperty('--drawer-size', `${v}px`);
				containerRef.current.style.setProperty('--drawer-progress', `${p}`);
				if (debug) console.log('[Drawer] CSS vars updated', { size: v, progress: p });
			}
		});
		return () => unsub();
	}, [debug, maxSize, onProgressChange, size, progress]);

	// Decide absolute positioning style per side
	const containerStyle = useMemo<React.CSSProperties>(() => {
		const common: React.CSSProperties = {
			// CSS var for handle thickness
			['--handle-size' as unknown as string]: `${handleSize}px`,
			// Initial values; will be updated by size.on('change')
			['--drawer-size' as unknown as string]: `${initialSize}px`,
			['--drawer-progress' as unknown as string]: `${clamp(initialSize / maxSize, 0, 1)}`,
		};
		if (side === 'bottom') {
			// Use CSS var for dynamic height
			return { ...common, left: 0, right: 0, bottom: 0 };
		}
		if (side === 'top') {
			return { ...common, left: 0, right: 0, top: 0 };
		}
		if (side === 'left') {
			return { ...common, top: 0, bottom: 0, left: 0 };
		}
		return { ...common, top: 0, bottom: 0, right: 0 };
	}, [handleSize, initialSize, maxSize, side]);

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
		const next = clamp(startSizeRef.current + delta, 0, maxSize);
		size.set(next);
		if (debug) {
			const progress = clamp(next / maxSize, 0, 1);
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
		
		// snapping: snap to max if close to max, snap to 0 if close to min
		const cur = size.get();
		const thr = snapThreshold <= 1 ? maxSize * snapThreshold : snapThreshold;
		const willSnapMax = maxSize - cur <= thr;
		const willSnapMin = cur <= thr;
		if (debug) console.log('[Drawer] pointerup', { cur, thr, willSnapMax, willSnapMin });
		if (willSnapMax) {
			animate(size, maxSize, { duration: 0.25 });
		} else if (willSnapMin) {
			animate(size, 0, { duration: 0.25 });
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