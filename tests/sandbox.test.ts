import { afterEach, expect, it } from "vitest";
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => { await host?.dispose(); host = undefined; });

it("records real content actions, preserves history across restart, and validates private admin screens", async () => {
	host = await createPluginRuntimeTestHost();
	await host.transport.invokeHook("plugin:install", {});
	const user = await host.fixtures.user({ email: "admin@example.test", role: "admin" });
	await host.fixtures.collection({ slug: "posts", label: "Posts", fields: [{ slug: "title", label: "Title", type: "string" }] });
	const created = await host.actions.content.create("posts", { data: { title: "Original" } });
	if (!created.success) throw new Error(created.error.message);
	const id = created.data.item.id;
	expect(await host.actions.content.update("posts", id, { data: { title: "Updated" } })).toMatchObject({ success: true });
	expect(await host.actions.content.trash("posts", id)).toMatchObject({ success: true });
	await host.restart();
	const list = await host.actions.routes.request("history/list", { method: "POST", body: { filters: { window: "all" } }, user, headers: { "X-EmDash-Request": "1" } });
	expect(await list.json()).toMatchObject({ success: true, data: { items: expect.arrayContaining([
		expect.objectContaining({ data: expect.objectContaining({ action: "create", resourceId: id }) }),
		expect.objectContaining({ data: expect.objectContaining({ action: "update", resourceId: id }) }),
		expect.objectContaining({ data: expect.objectContaining({ action: "delete", resourceId: id }) }),
	]) } });
	const page = await host.admin.loadPage("/history", { user });
	expect(page.blocks.some(block => block.type === "table")).toBe(true);
	expect((await host.admin.loadWidget("recent-activity", { user })).blocks.length).toBeGreaterThan(0);
	expect((await host.actions.routes.request("history/list", { method: "POST", body: {} })).status).toBe(401);
	const invalid = await host.actions.routes.request("history/list", {
		method: "POST", body: { filters: { action: "invalid" } }, user, headers: { "X-EmDash-Request": "1" },
	});
	expect(invalid.status).toBe(400);
});
