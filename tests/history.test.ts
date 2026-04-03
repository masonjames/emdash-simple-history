import { describe, expect, it } from "vitest";

import {
	buildEntryFromAfterDelete,
	buildEntryFromAfterSave,
	HistoryValidationError,
	normalizeHistoryFilters,
	normalizeHistoryListRequest,
	normalizeSettingsInput,
	serializeTrackedCollections,
} from "../src/history.js";

describe("history helpers", () => {
	it("builds create and update entries from save events", () => {
		const now = new Date("2026-04-02T12:00:00.000Z");

		const createEntry = buildEntryFromAfterSave(
			{
				collection: "posts",
				isNew: true,
				content: { id: "post_1", slug: "hello-world", status: "published", data: { title: "Hello world" } },
			},
			now,
			() => "evt_create",
		);

		const updateEntry = buildEntryFromAfterSave(
			{
				collection: "posts",
				isNew: false,
				content: { id: "post_1", slug: "hello-world", status: "draft", data: { title: "Updated title" } },
			},
			now,
			() => "evt_update",
		);

		expect(createEntry).toEqual({
			id: "evt_create",
			entry: {
				timestamp: now.toISOString(),
				action: "create",
				collection: "posts",
				resourceId: "post_1",
				resourceType: "content",
				metadata: { title: "Hello world", slug: "hello-world", status: "published" },
			},
		});

		expect(updateEntry?.entry.action).toBe("update");
		expect(updateEntry?.entry.metadata?.status).toBe("draft");
	});

	it("builds delete entries and skips missing ids", () => {
		const now = new Date("2026-04-02T12:00:00.000Z");
		const entry = buildEntryFromAfterDelete(
			{ collection: "pages", id: 42 },
			now,
			() => "evt_delete",
		);

		expect(entry).toEqual({
			id: "evt_delete",
			entry: {
				timestamp: now.toISOString(),
				action: "delete",
				collection: "pages",
				resourceId: "42",
				resourceType: "content",
			},
		});

		expect(buildEntryFromAfterDelete({ collection: "pages", id: null }, now, () => "noop")).toBeNull();
	});

	it("normalizes filter windows and custom ranges", () => {
		const now = new Date("2026-04-02T12:00:00.000Z");
		const rolling = normalizeHistoryFilters({ window: "7d", collection: "posts", action: "update" }, now);
		expect(rolling.collection).toBe("posts");
		expect(rolling.action).toBe("update");
		expect(rolling.from).toBe("2026-03-26T12:00:00.000Z");

		const custom = normalizeHistoryFilters({ window: "custom", from: "2026-03-01", to: "2026-03-07" }, now);
		expect(custom.from).toBe("2026-03-01T00:00:00.000Z");
		expect(custom.to).toBe("2026-03-07T23:59:59.999Z");
	});

	it("rejects invalid filter input", () => {
		expect(() => normalizeHistoryFilters({ action: "publish" }, new Date())).toThrow(HistoryValidationError);
		expect(() => normalizeHistoryFilters({ window: "custom", from: "nope" }, new Date())).toThrow(HistoryValidationError);
	});

	it("clamps list requests and settings", () => {
		const request = normalizeHistoryListRequest({ limit: 999, filters: {} }, 50, new Date());
		expect(request.limit).toBe(50);

		const settings = normalizeSettingsInput(
			{
				retentionDays: "30",
				trackedCollectionsCsv: "posts, pages, posts",
				showWidget: "false",
				maxPageSize: 999,
			},
			{
				retentionDays: 90,
				trackedCollections: [],
				showWidget: true,
				maxPageSize: 100,
			},
		);

		expect(settings).toEqual({
			retentionDays: 30,
			trackedCollections: ["posts", "pages"],
			showWidget: false,
			maxPageSize: 100,
		});
		expect(serializeTrackedCollections(settings.trackedCollections)).toBe("posts, pages");
	});
});
