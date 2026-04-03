import type {
	Block,
	BlockResponse,
	HistoryFilters,
	HistoryListItem,
	HistoryListResponse,
	HistorySummaryResponse,
	SimpleHistorySettings,
} from "./types.js";
import { serializeTrackedCollections } from "./history.js";

const ACTION_OPTIONS = [
	{ label: "Any action", value: "all" },
	{ label: "Created", value: "create" },
	{ label: "Updated", value: "update" },
	{ label: "Deleted", value: "delete" },
] as const;

const WINDOW_OPTIONS = [
	{ label: "All time", value: "all" },
	{ label: "Last 24 hours", value: "24h" },
	{ label: "Last 7 days", value: "7d" },
	{ label: "Last 30 days", value: "30d" },
	{ label: "Custom range", value: "custom" },
] as const;

function toDateInputValue(value?: string): string | undefined {
	if (!value) return undefined;
	return value.length >= 10 ? value.slice(0, 10) : value;
}

function describeRetention(retention: HistorySummaryResponse["retention"]): string {
	if (retention.mode === "forever") return "Forever";
	return `Last ${retention.retentionDays} days`;
}

function describeFilters(filters: HistoryFilters): string {
	return [
		filters.collection ? `Collection: ${filters.collection}` : "All collections",
		filters.action ? `Action: ${filters.action}` : "Any action",
		(() => {
			switch (filters.window) {
				case "24h":
					return "Window: last 24 hours";
				case "7d":
					return "Window: last 7 days";
				case "30d":
					return "Window: last 30 days";
				case "custom":
					return `Window: custom${filters.from || filters.to ? ` (${toDateInputValue(filters.from) ?? "…"} → ${toDateInputValue(filters.to) ?? "…"})` : ""}`;
				default:
					return "Window: all time";
			}
		})(),
	].join(" • ");
}

function filtersAreDefault(filters: HistoryFilters): boolean {
	return !filters.collection && !filters.action && filters.window === "all";
}

function getCollectionOptions(
	summary: HistorySummaryResponse,
	settings: SimpleHistorySettings,
): Array<{ label: string; value: string }> {
	const collections = [...new Set([...summary.knownCollections, ...settings.trackedCollections])].sort();
	return [{ label: "All collections", value: "all" }, ...collections.map((collection) => ({ label: collection, value: collection }))];
}

function buildEntryLabel(item: HistoryListItem): string {
	return item.data.metadata?.title ?? item.data.metadata?.slug ?? item.data.resourceId;
}

function buildResourceCode(item: HistoryListItem): string {
	return item.data.metadata?.slug ?? item.data.resourceId;
}

export function encodePaginationState(filters: HistoryFilters, cursor?: string): string {
	return JSON.stringify({ filters, cursor });
}

export function decodePaginationState(
	value: string,
): { filters: Partial<HistoryFilters>; cursor?: string } | null {
	try {
		const parsed = JSON.parse(value) as { filters?: Partial<HistoryFilters>; cursor?: string };
		if (!parsed || typeof parsed !== "object") return null;
		return {
			filters: parsed.filters ?? {},
			cursor: typeof parsed.cursor === "string" ? parsed.cursor : undefined,
		};
	} catch {
		return null;
	}
}

function buildHistoryTable(list: HistoryListResponse): Block {
	return {
		type: "table",
		block_id: "history-table",
		columns: [
			{ key: "action", label: "Action", format: "badge" },
			{ key: "collection", label: "Collection", format: "text" },
			{ key: "item", label: "Item", format: "text" },
			{ key: "resource", label: "Resource", format: "code" },
			{ key: "time", label: "When", format: "relative_time" },
		],
		rows: list.items.map((item) => ({
			action: item.data.action,
			collection: item.data.collection,
			item: buildEntryLabel(item),
			resource: buildResourceCode(item),
			time: item.data.timestamp,
		})),
		page_action_id: "history_next_page",
		...(list.nextCursor
			? { next_cursor: encodePaginationState(list.appliedFilters, list.nextCursor) }
			: {}),
		empty_text: filtersAreDefault(list.appliedFilters)
			? "No history entries have been recorded yet."
			: "No history entries match the current filters.",
	};
}

function buildWidgetTable(items: HistoryListItem[]): Block {
	return {
		type: "table",
		block_id: "recent-activity",
		columns: [
			{ key: "action", label: "Action", format: "badge" },
			{ key: "item", label: "Item", format: "text" },
			{ key: "time", label: "When", format: "relative_time" },
		],
		rows: items.map((item) => ({
			action: item.data.action,
			item: `${item.data.collection} / ${buildEntryLabel(item)}`,
			time: item.data.timestamp,
		})),
		page_action_id: "history_next_page",
	};
}

export function buildHistoryPageBlocks(args: {
	summary: HistorySummaryResponse;
	list: HistoryListResponse;
	settings: SimpleHistorySettings;
	errorMessage?: string;
}): BlockResponse {
	const { summary, list, settings, errorMessage } = args;
	const blocks: Block[] = [
		{ type: "header", text: "Simple History" },
		{
			type: "context",
			text: "Operational activity history for content lifecycle changes. It is intentionally narrower than a compliance-grade audit trail.",
		},
	];

	if (errorMessage) {
		blocks.push({
			type: "banner",
			variant: "error",
			description: errorMessage,
		});
	}

	blocks.push({
		type: "stats",
		items: [
			{ label: "Retained entries", value: summary.totals.retained },
			{ label: "Last 24h", value: summary.windows.last24h },
			{ label: "Last 7d", value: summary.windows.last7d },
			{ label: "Active collections", value: summary.collections.length },
		],
	});

	blocks.push({
		type: "fields",
		fields: [
			{ label: "Retention", value: describeRetention(summary.retention) },
			{
				label: "Tracked collections",
				value:
					settings.trackedCollections.length > 0
						? settings.trackedCollections.join(", ")
						: "All collections",
			},
			{ label: "Widget", value: settings.showWidget ? "Enabled" : "Disabled" },
			{ label: "Page size cap", value: String(settings.maxPageSize) },
		],
	});

	if (summary.collections.length > 0) {
		blocks.push({
			type: "fields",
			fields: summary.collections.slice(0, 4).map((entry) => ({
				label: entry.collection,
				value: `${entry.count} entr${entry.count === 1 ? "y" : "ies"}`,
			})),
		});
	}

	blocks.push({ type: "divider" });
	blocks.push({
		type: "section",
		text: `History browser • ${describeFilters(list.appliedFilters)}`,
	});
	blocks.push({
		type: "form",
		block_id: "history-filters",
		fields: [
			{
				type: "select",
				action_id: "collection",
				label: "Collection",
				options: getCollectionOptions(summary, settings),
				initial_value: list.appliedFilters.collection ?? "all",
			},
			{
				type: "select",
				action_id: "action",
				label: "Action",
				options: [...ACTION_OPTIONS],
				initial_value: list.appliedFilters.action ?? "all",
			},
			{
				type: "select",
				action_id: "window",
				label: "Window",
				options: [...WINDOW_OPTIONS],
				initial_value: list.appliedFilters.window,
			},
			{
				type: "date_input",
				action_id: "from",
				label: "From",
				initial_value: toDateInputValue(list.appliedFilters.from),
				condition: { field: "window", eq: "custom" },
			},
			{
				type: "date_input",
				action_id: "to",
				label: "To",
				initial_value: toDateInputValue(list.appliedFilters.to),
				condition: { field: "window", eq: "custom" },
			},
		],
		submit: { label: "Apply filters", action_id: "history_apply_filters" },
	});

	if (!filtersAreDefault(list.appliedFilters)) {
		blocks.push({
			type: "actions",
			elements: [{ type: "button", action_id: "history_reset_filters", label: "Reset filters", style: "secondary" }],
		});
	}

	blocks.push(buildHistoryTable(list));
	blocks.push({
		type: "context",
		text: "Resource values use the current collection slug and item slug or ID so operators can jump quickly with the admin command palette or search.",
	});

	blocks.push({ type: "divider" });
	blocks.push({ type: "section", text: "Settings" });
	blocks.push({
		type: "context",
		text: "Retention applies immediately to reads. Tracked collections only affect future events; existing history is preserved until retention removes it.",
	});
	blocks.push({
		type: "form",
		block_id: "history-settings",
		fields: [
			{
				type: "number_input",
				action_id: "retentionDays",
				label: "Retention days",
				initial_value: settings.retentionDays,
				min: 0,
				max: 3650,
			},
			{
				type: "text_input",
				action_id: "trackedCollectionsCsv",
				label: "Tracked collections (CSV)",
				placeholder: "posts, pages",
				initial_value: serializeTrackedCollections(settings.trackedCollections),
			},
			{
				type: "toggle",
				action_id: "showWidget",
				label: "Show dashboard widget",
				description: "The widget remains registered, but it will render a disabled state when turned off.",
				initial_value: settings.showWidget,
			},
			{
				type: "number_input",
				action_id: "maxPageSize",
				label: "Maximum page size",
				initial_value: settings.maxPageSize,
				min: 1,
				max: 100,
			},
		],
		submit: { label: "Save settings", action_id: "history_save_settings" },
	});

	return { blocks };
}

export function buildRecentActivityWidgetBlocks(args: {
	summary: HistorySummaryResponse;
	items: HistoryListItem[];
	widgetEnabled: boolean;
	errorMessage?: string;
}): BlockResponse {
	const { summary, items, widgetEnabled, errorMessage } = args;
	const blocks: Block[] = [];

	if (errorMessage) {
		blocks.push({
			type: "banner",
			variant: "error",
			description: errorMessage,
		});
	}

	if (!widgetEnabled) {
		blocks.push({
			type: "context",
			text: "Recent activity is disabled in Simple History settings.",
		});
		return { blocks };
	}

	blocks.push({
		type: "stats",
		items: [
			{ label: "Last 24h", value: summary.windows.last24h },
			{ label: "Last 7d", value: summary.windows.last7d },
			{ label: "Retained", value: summary.totals.retained },
		],
	});

	if (items.length === 0) {
		blocks.push({
			type: "context",
			text: "No recent activity in the current retention window.",
		});
	} else {
		blocks.push(buildWidgetTable(items));
	}

	blocks.push({
		type: "context",
		text: `Retention: ${describeRetention(summary.retention)}.`,
	});

	return { blocks };
}
