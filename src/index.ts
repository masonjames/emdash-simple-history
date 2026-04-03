import type { PluginDescriptor } from "emdash";

export function simpleHistoryPlugin(): PluginDescriptor {
	return {
		id: "simple-history",
		version: "0.1.0",
		format: "standard",
		entrypoint: "@masonjames/emdash-simple-history/sandbox",
		capabilities: ["read:content"],
		storage: {
			entries: {
				// Composite indexes are supported by EmDash runtime storage/manifest handling,
				// but the current PluginDescriptor typing still narrows this field to string[].
				indexes: [
					"timestamp",
					"action",
					"collection",
					["collection", "timestamp"],
					["action", "timestamp"],
				] as unknown as string[],
			},
		},
		adminPages: [{ path: "/history", label: "History", icon: "history" }],
		adminWidgets: [{ id: "recent-activity", title: "Recent Activity", size: "half" }],
	};
}

export type {
	ContentDeleteEvent,
	ContentSaveEvent,
	HistoryFilters,
	HistoryListRequest,
	HistoryListResponse,
	HistorySummaryResponse,
	RetentionInfo,
	SimpleHistoryAction,
	SimpleHistoryEntry,
	SimpleHistorySettings,
} from "./types.js";
