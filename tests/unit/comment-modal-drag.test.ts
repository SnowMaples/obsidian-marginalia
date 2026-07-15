import {describe, expect, it} from 'vitest';
import {clampDraggableModalOffset, computeDraggableModalOffset} from '../../src/views/CommentModal';

describe('desktop comment modal drag geometry', () => {
	it('moves the modal by the pointer delta', () => {
		const offset = computeDraggableModalOffset({
			modalRect: rect({left: 220, top: 140, width: 560, height: 260}),
			pointerDelta: {x: 96, y: 48},
			startOffset: {x: 0, y: 0},
			viewport: {width: 1200, height: 800},
		});

		expect(offset).toEqual({x: 96, y: 48});
	});

	it('keeps dragged modals inside the viewport margin', () => {
		const offset = computeDraggableModalOffset({
			modalRect: rect({left: 220, top: 140, width: 560, height: 260}),
			pointerDelta: {x: -300, y: -180},
			startOffset: {x: 0, y: 0},
			viewport: {width: 1200, height: 800, margin: 8},
		});

		expect(offset).toEqual({x: -212, y: -132});
	});

	it('adds new drag movement to an existing offset', () => {
		const offset = computeDraggableModalOffset({
			modalRect: rect({left: 320, top: 220, width: 560, height: 260}),
			pointerDelta: {x: 40, y: 24},
			startOffset: {x: 100, y: 80},
			viewport: {width: 1200, height: 800},
		});

		expect(offset).toEqual({x: 140, y: 104});
	});

	it('re-clamps the current offset after the viewport shrinks', () => {
		const offset = clampDraggableModalOffset({
			currentOffset: {x: 160, y: 120},
			modalRect: rect({left: 720, top: 420, width: 560, height: 260}),
			viewport: {width: 1000, height: 640, margin: 8},
		});

		expect(offset).toEqual({x: -128, y: 72});
	});
});

function rect(options: {height: number; left: number; top: number; width: number}) {
	return {
		bottom: options.top + options.height,
		height: options.height,
		left: options.left,
		right: options.left + options.width,
		top: options.top,
		width: options.width,
	};
}
