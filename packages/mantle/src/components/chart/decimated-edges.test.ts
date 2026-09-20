import { describe, expect, test, vi } from "vitest";
import { drawDecimatedArea, drawDecimatedLine } from "./renderer.js";
import type { DecimatedColumns } from "./decimate.js";

/**
 * Records the decimated path's lineTo/moveTo vertices in CSS pixels. The
 * boundary-clipping regression lives in math, not raster pixels: a line that
 * crosses a window edge must start/end ON the boundary (x = plot left/right),
 * not at the first visible pixel-column center.
 */
const recordPath = () => {
	const vertices: Array<{ op: "move" | "line"; x: number; y: number }> = [];
	const ctx = {
		beginPath: vi.fn(),
		moveTo: (x: number, y: number) => vertices.push({ op: "move", x, y }),
		lineTo: (x: number, y: number) => vertices.push({ op: "line", x, y }),
		closePath: vi.fn(),
		stroke: vi.fn(),
		fill: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
	};
	return {
		vertices,
		ctx: Object.assign(ctx, {
			strokeStyle: "",
			lineWidth: 0,
			lineJoin: "",
			lineCap: "",
			globalAlpha: 1,
			fillStyle: "",
		}) as unknown as CanvasRenderingContext2D,
	};
};

const columns = (hasData: readonly number[], value: number): DecimatedColumns => ({
	columnCount: hasData.length,
	hasData: Uint8Array.from(hasData),
	minValue: Float64Array.from(hasData.map((has) => (has ? value : 0))),
	maxValue: Float64Array.from(hasData.map((has) => (has ? value : 0))),
	inValue: Float64Array.from(hasData.map((has) => (has ? value : 0))),
	outValue: Float64Array.from(hasData.map((has) => (has ? value : 0))),
});

// Plot: left=10, width=100 → right=110. Four columns, centers at 11.25/36.25/
// 61.25/86.25 — never on the boundary.
const columnToX = (column: number): number => 10 + (column + 0.5) / (4 / 100);

describe("drawDecimatedLine window edge anchors", () => {
	test("a crossing segment starts and ends the stroke on the plot boundaries", () => {
		const { vertices, ctx } = recordPath();
		drawDecimatedLine(ctx, {
			color: "#000",
			columns: columns([1, 1, 1, 1], 5),
			startEdge: { x: 10, y: 20 },
			endEdge: { x: 110, y: 80 },
			columnToX,
			valueK: 1,
			valueB: 0,
		});
		expect(vertices[0]).toEqual({ op: "move", x: 10, y: 20 });
		expect(vertices[1]).toEqual({ op: "line", x: columnToX(0), y: 5 });
		expect(vertices[vertices.length - 1]).toEqual({ op: "line", x: 110, y: 80 });
	});

	test("null anchors leave an in-window run starting at its first column", () => {
		const { vertices, ctx } = recordPath();
		drawDecimatedLine(ctx, {
			color: "#000",
			// The only data sits in the middle columns: no segment reaches either
			// edge, so no anchor may attach.
			columns: columns([0, 1, 1, 0], 5),
			startEdge: null,
			endEdge: null,
			columnToX,
			valueK: 1,
			valueB: 0,
		});
		expect(vertices[0]).toEqual({ op: "move", x: columnToX(1), y: 5 });
		expect(vertices[vertices.length - 1]).toEqual({ op: "line", x: columnToX(2), y: 5 });
		expect(vertices.some((vertex) => vertex.x === 10 || vertex.x === 110)).toBe(false);
	});

	test("an anchor attaches only to the run that reaches that edge across a gap", () => {
		const { vertices, ctx } = recordPath();
		drawDecimatedLine(ctx, {
			color: "#000",
			columns: columns([1, 0, 1, 1], 5),
			startEdge: { x: 10, y: 20 },
			endEdge: { x: 110, y: 80 },
			columnToX,
			valueK: 1,
			valueB: 0,
		});
		// First run: starts on the left edge and ends at column 0.
		expect(vertices[0]).toEqual({ op: "move", x: 10, y: 20 });
		// Second run: begins at column 2 with a fresh moveTo (no left anchor),
		// then reaches the right edge.
		const secondMove = vertices.findIndex(
			(vertex, index) => index > 0 && vertex.op === "move",
		);
		expect(vertices[secondMove]).toEqual({ op: "move", x: columnToX(2), y: 5 });
		expect(vertices[vertices.length - 1]).toEqual({ op: "line", x: 110, y: 80 });
	});
});

describe("drawDecimatedArea window edge anchors", () => {
	test("the fill closes vertically on both boundaries (upper and lower)", () => {
		const { vertices, ctx } = recordPath();
		drawDecimatedArea(ctx, {
			color: "#000",
			lowerColumns: columns([1, 1, 1, 1], 0),
			upperColumns: columns([1, 1, 1, 1], 5),
			startUpperEdge: { x: 10, y: 20 },
			startLowerEdge: { x: 10, y: 0 },
			endUpperEdge: { x: 110, y: 80 },
			endLowerEdge: { x: 110, y: 0 },
			columnToX,
			valueK: 1,
			valueB: 0,
		});
		expect(vertices[0]).toEqual({ op: "move", x: 10, y: 20 });
		// Traversing forward along the upper edge, then down the right edge...
		expect(vertices.some((vertex) => vertex.x === 110 && vertex.y === 80)).toBe(true);
		expect(vertices.some((vertex) => vertex.x === 110 && vertex.y === 0)).toBe(true);
		// ...and back along the baseline. The last explicit vertex is the lower
		// left edge anchor; closePath() then seals the vertical edge.
		expect(vertices[vertices.length - 2]).toEqual({ op: "line", x: columnToX(0), y: 0 });
		expect(vertices[vertices.length - 1]).toEqual({ op: "line", x: 10, y: 0 });
	});
});
