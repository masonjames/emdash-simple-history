import { describe, expect, it } from "vitest";

import {
	buildHistoryPageBlocks,
	buildRecentActivityWidgetBlocks,
	decodePaginationState,
	encodePaginationState,
} from "../src/admin-blocks.js";
import type { HistoryListResponse, HistorySummaryResponse, SimpleHistorySettings } from "../src/types.js";

const summary: HistorySummaryResponse = {
	totals: { retained: 12, create: 4, update: 6, delete: 2 },
	windows: { last24h: 3, last7d: 9, last30d: 12 },
	collections: [{ collection: "posts", count: 8 }, { collection: "pages", count: 4 }],
	knownCollections: ["pages", "posts"],
	retention: { mode: "days", retentionDays: 90, cutoff: "2026-01-03T00:00:00.000Z", lastSweepAt: "2026-04-02T12:00:00.000Z" },
	widget: { showWidget: true },
};

const settings: SimpleHistorySettings = {
	retentionDays: 90,
	trackedCollections: ["posts", "pages"],
	showWidget: true,
	maxPageSize: 100,
};

const list: HistoryListResponse = {
	items: [
		{
			id: "evt_1",
			adminPath: "/_emdash/admin/content/posts/post_1",
			data: {
				timestamp: "2026-04-02T12:00:00.000Z",
				action: "update",
				collection: "posts",
				resourceId: "post_1",
				resourceType: "content",
				metadata: { title: "Hello world", slug: "hello-world" },
			},
		},
	],
	nextCursor: "opaque_cursor",
	hasMore: true,
	appliedFilters: { window: "all" },
	pageSize: 25,
	retention: summary.retention,
};

describe("admin block builders", () => {
	it("encodes and decodes pagination state", () => {
		const encoded = encodePaginationState({ window: "7d", collection: "posts" }, "abc");
		expect(decodePaginationState(encoded)).toEqual({
			filters: { window: "7d", collection: "posts" },
			cursor: "abc",
		});
	});

	it("builds a history page with filters, table, and settings", () => {
		const response = buildHistoryPageBlocks({ summary, list, settings });
		expect(response.blocks.some((block) => block.type === "form" && block.block_id === "history-filters")).toBe(true);
		expect(response.blocks.some((block) => block.type === "form" && block.block_id === "history-settings")).toBe(true);

		const table = response.blocks.find((block) => block.type === "table") as { next_cursor?: string; rows?: unknown[] };
		expect(table.rows).toHaveLength(1);
		expect(table.next_cursor).toBeDefined();
		expect(decodePaginationState(table.next_cursor!)).toEqual({ filters: { window: "all" }, cursor: "opaque_cursor" });
	});

	it("builds a disabled widget state", () => {
		const response = buildRecentActivityWidgetBlocks({
			summary: { ...summary, widget: { showWidget: false } },
			items: [],
			widgetEnabled: false,
		});
		expect(response.blocks).toEqual([
			{ type: "context", text: "Recent activity is disabled in Simple History settings." },
		]);
	});
});
