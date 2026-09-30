import descriptor from "../dist/index.mjs";

// Keep the existing npm factory while using the CLI-generated descriptor.
export function simpleHistoryPlugin() {
	return descriptor;
}

export default descriptor;

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
