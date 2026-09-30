import { pluginResponse } from "emdash/plugin";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { buildHistoryPageBlocks, buildRecentActivityWidgetBlocks, decodePaginationState } from "./admin-blocks.js";
import {
	adminInteractionSchema,
	buildEntryFromAfterDelete,
	buildEntryFromAfterSave,
	DEFAULT_LIST_PAGE_SIZE,
	getHistoryList,
	getHistorySummary,
	HistoryValidationError,
	historyListRequestSchema,
	historySummaryRequestSchema,
	loadSettings,
	normalizeSettingsInput,
	recordEntry,
	saveSettings,
	seedDefaultSettings,
	shouldTrackCollection,
	WIDGET_PAGE_SIZE,
} from "./history.js";
import type { BlockResponse, HistoryListRequest } from "./types.js";

function getSafeErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof HistoryValidationError) return error.message;
	if (error instanceof Error) return error.message || fallback;
	return fallback;
}

function renderStaticErrorPage(message: string, toast?: BlockResponse["toast"]): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: "Simple History" },
			{
				type: "banner",
				variant: "error",
				description: message,
			},
			{
				type: "context",
				text: "Simple History could not load live data. Please try again, then check plugin storage and database health if the problem persists.",
			},
		],
		...(toast ? { toast } : {}),
	};
}

function renderStaticErrorWidget(message: string): BlockResponse {
	return {
		blocks: [
			{
				type: "banner",
				variant: "error",
				description: message,
			},
			{
				type: "context",
				text: "Recent activity is temporarily unavailable.",
			},
		],
	};
}

async function renderHistoryPage(
	ctx: PluginContext,
	options?: {
		request?: HistoryListRequest;
		toast?: BlockResponse["toast"];
		errorMessage?: string;
	},
): Promise<BlockResponse> {
	const request = options?.request ?? { filters: { window: "all" }, limit: DEFAULT_LIST_PAGE_SIZE };
	const [settings, summary, list] = await Promise.all([
		loadSettings(ctx),
		getHistorySummary(ctx),
		getHistoryList(ctx, request),
	]);

	return {
		...buildHistoryPageBlocks({
			summary,
			list,
			settings,
			errorMessage: options?.errorMessage,
		}),
		...(options?.toast ? { toast: options.toast } : {}),
	};
}

async function renderWidget(ctx: PluginContext, errorMessage?: string): Promise<BlockResponse> {
	const summary = await getHistorySummary(ctx);
	if (!summary.widget.showWidget) {
		return buildRecentActivityWidgetBlocks({
			summary,
			items: [],
			widgetEnabled: false,
			errorMessage,
		});
	}

	const list = await getHistoryList(ctx, {
		filters: { window: "7d" },
		limit: WIDGET_PAGE_SIZE,
	});

	return buildRecentActivityWidgetBlocks({
		summary,
		items: list.items,
		widgetEnabled: true,
		errorMessage,
	});
}

function jsonResponse(status: number, value: unknown) {
	return pluginResponse({
		status,
		headers: { "content-type": "application/json" },
		body: { kind: "text", value: JSON.stringify(value) },
	});
}

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": async (_event: unknown, ctx: PluginContext) => {
			await seedDefaultSettings(ctx);
			ctx.log.info("Simple History installed");
		},
		"plugin:activate": async (_event: unknown, ctx: PluginContext) => {
			await seedDefaultSettings(ctx);
			ctx.log.info("Simple History activated");
		},
		"content:afterSave": {
			timeout: 2000,
			errorPolicy: "continue",
			handler: async (event, ctx) => {
				const settings = await loadSettings(ctx);
				if (!shouldTrackCollection(event.collection, settings.trackedCollections)) {
					return;
				}

				const entry = buildEntryFromAfterSave(event);
				if (!entry) {
					ctx.log.warn(`Simple History skipped save event for collection "${event.collection}" because no resource id was present.`);
					return;
				}

				try {
					await recordEntry(ctx, entry);
				} catch (error) {
					ctx.log.error("Simple History failed to store a save event", error);
				}
			},
		},
		"content:afterDelete": {
			timeout: 2000,
			errorPolicy: "continue",
			handler: async (event, ctx) => {
				const settings = await loadSettings(ctx);
				if (!shouldTrackCollection(event.collection, settings.trackedCollections)) {
					return;
				}

				const entry = buildEntryFromAfterDelete(event);
				if (!entry) {
					ctx.log.warn(`Simple History skipped delete event for collection "${event.collection}" because no resource id was present.`);
					return;
				}

				try {
					await recordEntry(ctx, entry);
				} catch (error) {
					ctx.log.error("Simple History failed to store a delete event", error);
				}
			},
		},
	},
	routes: {
		"history/list": {
			request: { body: "json" },
			response: "raw",
			methods: ["POST"],
			input: historyListRequestSchema,
			handler: async (routeCtx, ctx) => {
				try {
					const parsed = historyListRequestSchema.safeParse(routeCtx.input);
					if (!parsed.success) return jsonResponse(400, { success: false, error: { code: "BAD_REQUEST", message: parsed.error.message } });
					return jsonResponse(200, { success: true, data: await getHistoryList(ctx, parsed.data) });
				} catch (error) {
					if (error instanceof HistoryValidationError) {
						return jsonResponse(400, { success: false, error: { code: "BAD_REQUEST", message: error.message } });
					}
					throw error;
				}
			},
		},
		"history/summary": {
			input: historySummaryRequestSchema,
			handler: async (_routeCtx, ctx) => {
				return getHistorySummary(ctx);
			},
		},
		admin: {
			input: adminInteractionSchema,
			handler: async (routeCtx, ctx) => {
				const interaction = adminInteractionSchema.parse(routeCtx.input);

				try {
					if (interaction.type === "page_load") {
						if (interaction.page === "/history" || interaction.page === "/settings") {
							return await renderHistoryPage(ctx);
						}

						return await renderWidget(ctx);
					}

					if (interaction.type === "form_submit") {
						if (interaction.action_id === "history_apply_filters") {
							return await renderHistoryPage(ctx, {
								request: {
									filters: interaction.values,
									limit: DEFAULT_LIST_PAGE_SIZE,
								},
							});
						}

						const currentSettings = await loadSettings(ctx);
						const nextSettings = normalizeSettingsInput(interaction.values, currentSettings);
						await saveSettings(ctx, nextSettings);

						return await renderHistoryPage(ctx, {
							toast: {
								message: "Simple History settings saved.",
								type: "success",
							},
						});
					}

					if (interaction.action_id === "history_reset_filters") {
						return await renderHistoryPage(ctx);
					}

					const cursorState = (() => {
						if (!interaction.value || typeof interaction.value !== "object") return null;
						const cursor = (interaction.value as { cursor?: unknown }).cursor;
						return typeof cursor === "string" ? decodePaginationState(cursor) : null;
					})();

					if (!cursorState) {
						throw new HistoryValidationError("The pagination state was invalid or missing.");
					}

					return await renderHistoryPage(ctx, {
						request: {
							filters: cursorState.filters,
							cursor: cursorState.cursor,
							limit: DEFAULT_LIST_PAGE_SIZE,
						},
					});
				} catch (error) {
					const message = getSafeErrorMessage(error, "Failed to load Simple History.");
					ctx.log.error("Simple History admin route failed", error);

					if (interaction.type === "page_load" && interaction.page === "widget:recent-activity") {
						return renderStaticErrorWidget(message);
					}

					return renderStaticErrorPage(message, {
						message,
						type: "error",
					});
				}
			},
		},
	},
};

export default plugin;
