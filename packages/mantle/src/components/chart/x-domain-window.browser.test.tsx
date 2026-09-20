"use client";

import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AreaChart } from "../area-chart/index.js";
import { LineChart } from "../line-chart/index.js";

/**
 * Real-browser window-clipping tests: only a canvas 2d context paints the
 * line/area paths, and the regression is a raster fact — a segment crossing
 * the window boundary must meet the exact plot edge instead of stopping at
 * the last in-window sample or folding outside data into the edge.
 */

const STYLE = `
:root {
	--color-chart-1: #ff0000;
	--color-chart-other: #ff0000;
	--border-color-card-muted: #e5e5e5;
	--border-color-card: #d4d4d4;
	--text-color-muted: #717171;
	--color-neutral-500: #737373;
	--background-color-card: #ffffff;
	--background-color-popover: #ffffff;
	--border-color-popover: #d4d4d4;
}
[data-slot="line-chart"],
[data-slot="area-chart"] {
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	background: #ffffff;
}
[data-slot$="-plot"] {
	position: relative;
	flex: 1;
	min-height: 0;
	width: 100%;
}
[data-slot$="-plot"] > canvas,
[data-slot$="-plot"] > [tabindex] {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}
[data-slot$="-tooltip"] {
	position: absolute;
	left: 0;
	top: 0;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border-width: 0;
}
`;

let styleElement: HTMLStyleElement;

beforeAll(() => {
	styleElement = document.createElement("style");
	styleElement.textContent = STYLE;
	document.head.appendChild(styleElement);
});

afterAll(() => {
	styleElement.remove();
});

const WIDTH = 400;
const HEIGHT = 200;
const PLOT_LEFT = 8;
const PLOT_TOP = 8;
const PLOT_WIDTH = WIDTH - PLOT_LEFT * 2;
const PLOT_HEIGHT = HEIGHT - PLOT_TOP - 24;

/** True when any pixel column near `x` carries a painted series pixel. */
const paintedColumnNear = (
	ctx: CanvasRenderingContext2D,
	x: number,
	color: [number, number, number],
	tolerance = 60,
): boolean => {
	for (let px = Math.max(0, Math.round(x) - 1); px <= Math.round(x) + 1; px++) {
		for (let py = PLOT_TOP; py < PLOT_TOP + PLOT_HEIGHT; py++) {
			const pixel = ctx.getImageData(px, py, 1, 1).data;
			if (
				Math.abs(pixel[0] - color[0]) < tolerance &&
				Math.abs(pixel[1] - color[1]) < tolerance &&
				Math.abs(pixel[2] - color[2]) < tolerance
			) {
				return true;
			}
		}
	}
	return false;
};

const paintedContext = async (container: HTMLElement): Promise<CanvasRenderingContext2D> => {
	const canvas = container.querySelector("canvas");
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error("expected a canvas");
	}
	await waitFor(() => {
		expect(canvas.width).toBeGreaterThan(0);
	});
	const ctx = canvas.getContext("2d");
	if (ctx == null) {
		throw new Error("expected a 2d context");
	}
	return ctx;
};

// Samples 0..100; the window [20, 80] leaves two flat segments crossing each
// boundary. y = 50 stays on screen across every window.
const data = Array.from({ length: 101 }, (_, index) => ({ x: index, a: 50 }));

describe("window boundary clipping", () => {
	test("a full-resolution line meets both plot edges exactly", async () => {
		const { container } = render(
			<div style={{ width: WIDTH, height: HEIGHT }}>
				<LineChart.Root
					data={data}
					xKey="x"
					xScale="linear"
					xDomain={[20, 80]}
					animate={false}
					aria-label="Windowed line"
				>
					<LineChart.Line dataKey="a" label="a" />
				</LineChart.Root>
			</div>,
		);
		const ctx = await paintedContext(container);
		// The crossing segment paints on the exact left and right boundaries.
		expect(paintedColumnNear(ctx, PLOT_LEFT, [255, 0, 0])).toBe(true);
		expect(paintedColumnNear(ctx, PLOT_LEFT + PLOT_WIDTH, [255, 0, 0])).toBe(true);
		// Nothing paints beyond the edges (clipped, not folded over).
		expect(paintedColumnNear(ctx, PLOT_LEFT - 3, [255, 0, 0])).toBe(false);
		expect(paintedColumnNear(ctx, PLOT_LEFT + PLOT_WIDTH + 3, [255, 0, 0])).toBe(false);
	});

	test("a full-resolution area closes on the zero baseline at both edges", async () => {
		// A rising line: the boundary-crossing segment enters the plot above
		// the baseline, so a fill that stops at the last in-window sample
		// leaves a diagonal gap at the edge instead of a vertical wall.
		const rising = Array.from({ length: 101 }, (_, index) => ({ x: index, a: index }));
		const { container } = render(
			<div style={{ width: WIDTH, height: HEIGHT }}>
				<AreaChart.Root
					data={rising}
					xKey="x"
					xScale="linear"
					xDomain={[20, 80]}
					animate={false}
					aria-label="Windowed area"
				>
					<AreaChart.Area dataKey="a" label="a" />
				</AreaChart.Root>
			</div>,
		);
		const ctx = await paintedContext(container);
		// The 10% wash over #ff0000 on white is ~(255, 230, 230); the edge
		// column carries it from the crossing value down to the baseline.
		const washColumnHasFill = (x: number): boolean => {
			const column = ctx.getImageData(Math.round(x), PLOT_TOP, 1, PLOT_HEIGHT).data;
			for (let py = 0; py < PLOT_HEIGHT; py++) {
				const r = column[py * 4];
				const g = column[py * 4 + 1];
				if (r != null && g != null && r > 245 && g < 245) {
					return true;
				}
			}
			return false;
		};
		expect(washColumnHasFill(PLOT_LEFT)).toBe(true);
		expect(washColumnHasFill(PLOT_LEFT + PLOT_WIDTH)).toBe(true);
	});

	test("a decimated line meets both plot edges exactly", async () => {
		// 50,000 samples across a 384px plot is well past the 4× decimation
		// threshold; the window keeps ~60% of them, still deeply decimated.
		const dense = Array.from({ length: 50_000 }, (_, index) => ({
			x: (index / (50_000 - 1)) * 100,
			a: 50,
		}));
		const { container } = render(
			<div style={{ width: WIDTH, height: HEIGHT }}>
				<LineChart.Root
					data={dense}
					xKey="x"
					xScale="linear"
					xDomain={[20, 80]}
					animate={false}
					aria-label="Dense windowed line"
				>
					<LineChart.Line dataKey="a" label="a" />
				</LineChart.Root>
			</div>,
		);
		const ctx = await paintedContext(container);
		expect(paintedColumnNear(ctx, PLOT_LEFT, [255, 0, 0])).toBe(true);
		expect(paintedColumnNear(ctx, PLOT_LEFT + PLOT_WIDTH, [255, 0, 0])).toBe(true);
		expect(paintedColumnNear(ctx, PLOT_LEFT - 3, [255, 0, 0])).toBe(false);
		expect(paintedColumnNear(ctx, PLOT_LEFT + PLOT_WIDTH + 3, [255, 0, 0])).toBe(false);
	});
});
