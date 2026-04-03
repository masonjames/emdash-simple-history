export type SimpleHistoryAction = "create" | "update" | "delete";

export type HistoryWindow = "all" | "24h" | "7d" | "30d" | "custom";

export interface ContentSaveEvent {
	collection: string;
	isNew: boolean;
	content: Record<string, unknown> & {
		id?: string | number | null;
		slug?: string | null;
		status?: string | null;
		data?: Record<string, unknown> | null;
	};
}

export interface ContentDeleteEvent {
	collection: string;
	id: string | number | null;
}

export interface SimpleHistoryMetadata {
	title?: string;
	slug?: string;
	status?: string;
}

export interface SimpleHistoryEntry {
	timestamp: string;
	action: SimpleHistoryAction;
	collection: string;
	resourceId: string;
	resourceType: "content";
	metadata?: SimpleHistoryMetadata;
}

export interface PersistableEntry {
	id: string;
	entry: SimpleHistoryEntry;
}

export interface SimpleHistorySettings {
	retentionDays: number;
	trackedCollections: string[];
	showWidget: boolean;
	maxPageSize: number;
}

export interface RetentionInfo {
	mode: "forever" | "days";
	retentionDays: number;
	cutoff?: string;
	lastSweepAt?: string | null;
}

export interface HistoryFilters {
	collection?: string;
	action?: SimpleHistoryAction;
	window: HistoryWindow;
	from?: string;
	to?: string;
}

export interface HistoryListRequest {
	filters?: Partial<HistoryFilters>;
	cursor?: string;
	limit?: number;
}

export interface HistoryListItem {
	id: string;
	data: SimpleHistoryEntry;
	adminPath: string;
}

export interface HistoryListResponse {
	items: HistoryListItem[];
	nextCursor?: string;
	hasMore: boolean;
	appliedFilters: HistoryFilters;
	pageSize: number;
	retention: RetentionInfo;
}

export interface HistorySummaryResponse {
	totals: {
		retained: number;
		create: number;
		update: number;
		delete: number;
	};
	windows: {
		last24h: number;
		last7d: number;
		last30d: number;
	};
	collections: Array<{ collection: string; count: number }>;
	knownCollections: string[];
	retention: RetentionInfo;
	widget: {
		showWidget: boolean;
	};
}

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
	message: string;
	type: ToastType;
}

export type Block = Record<string, unknown>;

export interface BlockResponse {
	blocks: Block[];
	toast?: ToastMessage;
}
