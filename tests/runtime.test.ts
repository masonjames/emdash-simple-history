import { describe, expect, it } from "vitest";

import plugin from "../src/sandbox-entry.js";
import { getHistorySummary } from "../src/history.js";
import { createTestPluginContext, invokeStandardHook, invokeStandardRoute } from "./helpers/fakes.js";

describe("runtime plugin behavior", () => {
	it("seeds default settings on install", async () => {
		const { ctx, kv } = createTestPluginContext();
		await invokeStandardHook(plugin, "plugin:install", {}, ctx);
		expect(await kv.get("settings:retentionDays")).toBe(90);
		expect(await kv.get("settings:showWidget")).toBe(true);
		expect(await kv.get("settings:trackedCollections")).toEqual([]);
	});

	it("records create, update, and delete events", async () => {
		const { ctx, entries } = createTestPluginContext();
		await invokeStandardHook(plugin, "plugin:install", {}, ctx);

		await invokeStandardHook(
			plugin,
			"content:afterSave",
			{
				collection: "posts",
				isNew: true,
				content: { id: "post_1", slug: "hello-world", status: "published", data: { title: "Hello world" } },
			},
			ctx,
		);

		await invokeStandardHook(
			plugin,
			"content:afterSave",
			{
				collection: "posts",
				isNew: false,
				content: { id: "post_1", slug: "hello-world", status: "draft", data: { title: "Hello world" } },
			},
			ctx,
		);

		await invokeStandardHook(plugin, "content:afterDelete", { collection: "posts", id: "post_1" }, ctx);

		const actions = entries.toArray().map((entry) => entry.data.action).sort();
		expect(actions).toEqual(["create", "delete", "update"]);
	});

	it("skips untracked collections", async () => {
		const { ctx, entries, kv } = createTestPluginContext({ "settings:trackedCollections": ["pages"] });
		await invokeStandardHook(
			plugin,
			"content:afterSave",
			{ collection: "posts", isNew: true, content: { id: "post_1", data: { title: "Ignored" } } },
			ctx,
		);
		expect(entries.toArray()).toHaveLength(0);
		expect(await kv.get("state:knownCollections")).toBeNull();
	});

	it("lists paginated filtered history through the private route contract", async () => {
		const { ctx, entries } = createTestPluginContext();
		await entries.putMany([
			{
				id: "a",
				data: { timestamp: "2026-04-02T12:00:00.000Z", action: "create", collection: "posts", resourceId: "1", resourceType: "content" },
			},
			{
				id: "b",
				data: { timestamp: "2026-04-02T11:00:00.000Z", action: "create", collection: "posts", resourceId: "2", resourceType: "content" },
			},
			{
				id: "c",
				data: { timestamp: "2026-04-01T10:00:00.000Z", action: "update", collection: "pages", resourceId: "3", resourceType: "content" },
			},
		]);

		const firstPage = (await invokeStandardRoute(plugin, "history/list", ctx, {
			filters: { action: "create", window: "all" },
			limit: 1,
		})) as { items: Array<{ id: string }>; nextCursor?: string; hasMore: boolean };

		expect(firstPage.items).toHaveLength(1);
		expect(firstPage.hasMore).toBe(true);
		expect(firstPage.nextCursor).toBeDefined();

		const secondPage = (await invokeStandardRoute(plugin, "history/list", ctx, {
			filters: { action: "create", window: "all" },
			limit: 1,
			cursor: firstPage.nextCursor,
		})) as { items: Array<{ id: string }>; hasMore: boolean };

		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.hasMore).toBe(false);
	});

	it("applies retention during reads and sweeps expired entries", async () => {
		const { ctx, entries } = createTestPluginContext({ "settings:retentionDays": 30 });
		await entries.putMany([
			{
				id: "old",
				data: { timestamp: "2025-12-01T00:00:00.000Z", action: "create", collection: "posts", resourceId: "old", resourceType: "content" },
			},
			{
				id: "new",
				data: { timestamp: "2026-04-01T00:00:00.000Z", action: "update", collection: "posts", resourceId: "new", resourceType: "content" },
			},
		]);

		const summary = await getHistorySummary(ctx, new Date("2026-04-02T12:00:00.000Z"));
		expect(summary.totals.retained).toBe(1);
		expect(entries.toArray().some((entry) => entry.id === "old")).toBe(false);
	});

	it("renders admin page and widget flows", async () => {
		const { ctx, kv } = createTestPluginContext();
		await invokeStandardHook(plugin, "plugin:install", {}, ctx);
		await invokeStandardHook(
			plugin,
			"content:afterSave",
			{ collection: "posts", isNew: true, content: { id: "post_1", slug: "hello-world", data: { title: "Hello world" } } },
			ctx,
		);

		const page = (await invokeStandardRoute(plugin, "admin", ctx, {
			type: "page_load",
			page: "/history",
		})) as { blocks: Array<Record<string, unknown>> };
		expect(page.blocks.some((block) => block.type === "table")).toBe(true);

		const saveResult = (await invokeStandardRoute(plugin, "admin", ctx, {
			type: "form_submit",
			action_id: "history_save_settings",
			values: {
				retentionDays: 14,
				trackedCollectionsCsv: "posts",
				showWidget: false,
				maxPageSize: 50,
			},
		})) as { toast?: { type: string } };
		expect(saveResult.toast?.type).toBe("success");
		expect(await kv.get("settings:showWidget")).toBe(false);

		const widget = (await invokeStandardRoute(plugin, "admin", ctx, {
			type: "page_load",
			page: "widget:recent-activity",
		})) as { blocks: Array<Record<string, unknown>> };
		expect(widget.blocks).toEqual([
			{ type: "context", text: "Recent activity is disabled in Simple History settings." },
		]);
	});

	it("returns static admin fallbacks when storage queries fail", async () => {
		const { ctx, entries } = createTestPluginContext();
		await invokeStandardHook(plugin, "plugin:install", {}, ctx);
		Object.assign(entries, {
			query: (async () => {
				throw new Error("storage offline");
			}) as typeof entries.query,
		});

		const page = (await invokeStandardRoute(plugin, "admin", ctx, {
			type: "page_load",
			page: "/history",
		})) as { blocks: Array<Record<string, unknown>>; toast?: { type: string; message: string } };
		expect(page.toast?.type).toBe("error");
		expect(page.blocks.some((block) => block.type === "banner")).toBe(true);

		const widget = (await invokeStandardRoute(plugin, "admin", ctx, {
			type: "page_load",
			page: "widget:recent-activity",
		})) as { blocks: Array<Record<string, unknown>> };
		expect(widget.blocks).toEqual([
			expect.objectContaining({ type: "banner", variant: "error", description: "storage offline" }),
			expect.objectContaining({ type: "context", text: "Recent activity is temporarily unavailable." }),
		]);
	});
});
