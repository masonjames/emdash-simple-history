import type { PluginContext, StorageCollection } from "emdash";
import { z } from "zod";
import { ulid } from "ulidx";

import type {
	ContentDeleteEvent,
	ContentSaveEvent,
	HistoryFilters,
	HistoryListRequest,
	HistoryListResponse,
	HistorySummaryResponse,
	PersistableEntry,
	RetentionInfo,
	SimpleHistoryAction,
	SimpleHistoryEntry,
	SimpleHistorySettings,
} from "./types.js";

type RangeWhere = {
	gt?: number | string;
	gte?: number | string;
	lt?: number | string;
	lte?: number | string;
};

type InWhere = {
	in: Array<string | number>;
};

type StartsWithWhere = {
	startsWith: string;
};

type WhereClause = Record<string, string | number | boolean | null | RangeWhere | InWhere | StartsWithWhere>;

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_SHOW_WIDGET = true;
export const DEFAULT_MAX_PAGE_SIZE = 100;
export const DEFAULT_LIST_PAGE_SIZE = 25;
export const WIDGET_PAGE_SIZE = 5;

const ABSOLUTE_MAX_PAGE_SIZE = 100;
const MAX_RETENTION_DAYS = 3650;
const RETENTION_SWEEP_BATCH_SIZE = 200;
const RETENTION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SUMMARY_COLLECTIONS = 50;
const MAX_METADATA_VALUE_LENGTH = 160;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SETTINGS_RETENTION_DAYS_KEY = "settings:retentionDays";
const SETTINGS_TRACKED_COLLECTIONS_KEY = "settings:trackedCollections";
const SETTINGS_SHOW_WIDGET_KEY = "settings:showWidget";
const SETTINGS_MAX_PAGE_SIZE_KEY = "settings:maxPageSize";
const STATE_KNOWN_COLLECTIONS_KEY = "state:knownCollections";
const STATE_LAST_RETENTION_SWEEP_AT_KEY = "state:lastRetentionSweepAt";

const rawFiltersSchema = z
	.object({
		collection: z.unknown().optional(),
		action: z.unknown().optional(),
		window: z.unknown().optional(),
		from: z.unknown().optional(),
		to: z.unknown().optional(),
	})
	.default({});

export const historyListRequestSchema = z
	.object({
		filters: rawFiltersSchema.optional().default({}),
		cursor: z.string().trim().optional(),
		limit: z.coerce.number().int().positive().max(1000).optional(),
	})
	.default({ filters: {} });

export const historySummaryRequestSchema = z.object({}).passthrough().default({});

export const adminInteractionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("page_load"),
		page: z.union([z.literal("/history"), z.literal("/settings"), z.literal("widget:recent-activity")]),
	}),
	z.object({
		type: z.literal("form_submit"),
		action_id: z.union([z.literal("history_apply_filters"), z.literal("history_save_settings")]),
		block_id: z.string().optional(),
		values: z.record(z.string(), z.unknown()),
	}),
	z.object({
		type: z.literal("block_action"),
		action_id: z.union([z.literal("history_next_page"), z.literal("history_reset_filters")]),
		block_id: z.string().optional(),
		value: z.unknown().optional(),
	}),
]);

export type HistoryListRouteInput = z.infer<typeof historyListRequestSchema>;
export type HistorySummaryRouteInput = z.infer<typeof historySummaryRequestSchema>;
export type AdminInteraction = z.infer<typeof adminInteractionSchema>;

export class HistoryValidationError extends Error {
	override name = "HistoryValidationError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return [...new Set(value.map((item) => normalizeOptionalString(item)).filter(Boolean) as string[])];
	}

	if (typeof value === "string") {
		return [
			...new Set(
				value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean),
			),
		];
	}

	return [];
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["true", "1", "yes", "on"].includes(normalized)) return true;
		if (["false", "0", "no", "off"].includes(normalized)) return false;
	}

	return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
	const candidate =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim().length > 0
				? Number(value)
				: Number.NaN;

	if (!Number.isFinite(candidate)) return fallback;
	return clamp(Math.trunc(candidate), min, max);
}

function laterOf(left?: string, right?: string): string | undefined {
	if (!left) return right;
	if (!right) return left;
	return left > right ? left : right;
}

function toResourceId(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}

	return null;
}

function truncate(value: string | undefined, maxLength = MAX_METADATA_VALUE_LENGTH): string | undefined {
	if (!value) return undefined;
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function parseDateInput(value: unknown, endOfDay: boolean): string | undefined {
	const raw = normalizeOptionalString(value);
	if (!raw) return undefined;

	const parsed = DATE_ONLY_PATTERN.test(raw)
		? new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
		: new Date(raw);

	if (Number.isNaN(parsed.getTime())) {
		throw new HistoryValidationError(`Invalid date value "${raw}".`);
	}

	return parsed.toISOString();
}

function extractMetadata(content: ContentSaveEvent["content"]): SimpleHistoryEntry["metadata"] {
	const title = truncate(
		isRecord(content.data) && typeof content.data.title === "string" ? content.data.title.trim() : undefined,
	);
	const slug = truncate(normalizeOptionalString(content.slug));
	const status = truncate(normalizeOptionalString(content.status));

	if (!title && !slug && !status) return undefined;
	return {
		...(title ? { title } : {}),
		...(slug ? { slug } : {}),
		...(status ? { status } : {}),
	};
}

function normalizeWindow(value: unknown): HistoryFilters["window"] {
	if (value === "24h" || value === "7d" || value === "30d" || value === "custom") return value;
	return "all";
}

function normalizeAction(value: unknown): SimpleHistoryAction | undefined {
	const action = normalizeOptionalString(value);
	if (!action || action === "all") return undefined;
	if (action === "create" || action === "update" || action === "delete") return action;
	throw new HistoryValidationError(`Unsupported history action "${action}".`);
}

export function normalizeHistoryFilters(
	value: unknown,
	now: Date = new Date(),
): HistoryFilters {
	const input = isRecord(value) ? value : {};
	const window = normalizeWindow(input.window);

	const filters: HistoryFilters = {
		window,
		collection: (() => {
			const collection = normalizeOptionalString(input.collection);
			return collection && collection !== "all" ? collection : undefined;
		})(),
		action: normalizeAction(input.action),
	};

	if (window === "custom") {
		const from = parseDateInput(input.from, false);
		const to = parseDateInput(input.to, true);
		if (!from && !to) {
			throw new HistoryValidationError("Choose at least one boundary for a custom date range.");
		}
		if (from && to && from > to) {
			throw new HistoryValidationError("The custom date range start must be before the end.");
		}
		filters.from = from;
		filters.to = to;
		return filters;
	}

	if (window === "24h") {
		filters.from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
	} else if (window === "7d") {
		filters.from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
	} else if (window === "30d") {
		filters.from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
	}

	return filters;
}

export function normalizeHistoryListRequest(
	value: unknown,
	maxPageSize: number,
	now: Date = new Date(),
): Required<Pick<HistoryListRequest, "limit">> & Omit<HistoryListRequest, "limit"> & { filters: HistoryFilters } {
	const input = isRecord(value) ? value : {};

	return {
		cursor: normalizeOptionalString(input.cursor),
		limit: normalizeInteger(input.limit, DEFAULT_LIST_PAGE_SIZE, 1, maxPageSize),
		filters: normalizeHistoryFilters(input.filters, now),
	};
}

export function normalizeSettingsInput(
	value: unknown,
	current: SimpleHistorySettings,
): SimpleHistorySettings {
	const input = isRecord(value) ? value : {};

	return {
		retentionDays: normalizeInteger(input.retentionDays, current.retentionDays, 0, MAX_RETENTION_DAYS),
		trackedCollections: normalizeStringArray(input.trackedCollectionsCsv),
		showWidget: normalizeBoolean(input.showWidget, current.showWidget),
		maxPageSize: normalizeInteger(input.maxPageSize, current.maxPageSize, 1, ABSOLUTE_MAX_PAGE_SIZE),
	};
}

function buildRetentionInfo(
	settings: SimpleHistorySettings,
	cutoff: string | null,
	lastSweepAt: string | null,
): RetentionInfo {
	return {
		mode: cutoff ? "days" : "forever",
		retentionDays: settings.retentionDays,
		...(cutoff ? { cutoff } : {}),
		lastSweepAt,
	};
}

function getEntriesStorage(ctx: PluginContext): StorageCollection<SimpleHistoryEntry> {
	const entries = ctx.storage.entries as StorageCollection<SimpleHistoryEntry> | undefined;
	if (!entries) {
		throw new Error('Simple History storage collection "entries" is not available.');
	}
	return entries;
}

async function setDefaultIfMissing(ctx: PluginContext, key: string, defaultValue: unknown): Promise<void> {
	const existing = await ctx.kv.get(key);
	if (existing === null) {
		await ctx.kv.set(key, defaultValue);
	}
}

export async function seedDefaultSettings(ctx: PluginContext): Promise<void> {
	await setDefaultIfMissing(ctx, SETTINGS_RETENTION_DAYS_KEY, DEFAULT_RETENTION_DAYS);
	await setDefaultIfMissing(ctx, SETTINGS_TRACKED_COLLECTIONS_KEY, []);
	await setDefaultIfMissing(ctx, SETTINGS_SHOW_WIDGET_KEY, DEFAULT_SHOW_WIDGET);
	await setDefaultIfMissing(ctx, SETTINGS_MAX_PAGE_SIZE_KEY, DEFAULT_MAX_PAGE_SIZE);
	await setDefaultIfMissing(ctx, STATE_KNOWN_COLLECTIONS_KEY, []);
}

export async function loadSettings(ctx: PluginContext): Promise<SimpleHistorySettings> {
	const [retentionDays, trackedCollections, showWidget, maxPageSize] = await Promise.all([
		ctx.kv.get<number | string>(SETTINGS_RETENTION_DAYS_KEY),
		ctx.kv.get<string[] | string>(SETTINGS_TRACKED_COLLECTIONS_KEY),
		ctx.kv.get<boolean | string>(SETTINGS_SHOW_WIDGET_KEY),
		ctx.kv.get<number | string>(SETTINGS_MAX_PAGE_SIZE_KEY),
	]);

	return {
		retentionDays: normalizeInteger(retentionDays, DEFAULT_RETENTION_DAYS, 0, MAX_RETENTION_DAYS),
		trackedCollections: normalizeStringArray(trackedCollections),
		showWidget: normalizeBoolean(showWidget, DEFAULT_SHOW_WIDGET),
		maxPageSize: normalizeInteger(maxPageSize, DEFAULT_MAX_PAGE_SIZE, 1, ABSOLUTE_MAX_PAGE_SIZE),
	};
}

export async function saveSettings(ctx: PluginContext, settings: SimpleHistorySettings): Promise<void> {
	await Promise.all([
		ctx.kv.set(SETTINGS_RETENTION_DAYS_KEY, settings.retentionDays),
		ctx.kv.set(SETTINGS_TRACKED_COLLECTIONS_KEY, settings.trackedCollections),
		ctx.kv.set(SETTINGS_SHOW_WIDGET_KEY, settings.showWidget),
		ctx.kv.set(SETTINGS_MAX_PAGE_SIZE_KEY, settings.maxPageSize),
	]);
}

export async function loadKnownCollections(ctx: PluginContext): Promise<string[]> {
	return normalizeStringArray(await ctx.kv.get<string[] | string>(STATE_KNOWN_COLLECTIONS_KEY));
}

export async function rememberCollection(ctx: PluginContext, collection: string): Promise<void> {
	const normalizedCollection = normalizeOptionalString(collection);
	if (!normalizedCollection) return;

	const existing = await loadKnownCollections(ctx);
	if (existing.includes(normalizedCollection)) return;

	await ctx.kv.set(STATE_KNOWN_COLLECTIONS_KEY, [...existing, normalizedCollection].sort());
}

async function getLastSweepAt(ctx: PluginContext): Promise<string | null> {
	return normalizeOptionalString(await ctx.kv.get<string>(STATE_LAST_RETENTION_SWEEP_AT_KEY)) ?? null;
}

export function shouldTrackCollection(collection: string, trackedCollections: string[]): boolean {
	if (trackedCollections.length === 0) return true;
	return trackedCollections.includes(collection);
}

export function serializeTrackedCollections(trackedCollections: string[]): string {
	return trackedCollections.join(", ");
}

export function buildEntryFromAfterSave(
	event: ContentSaveEvent,
	now: Date = new Date(),
	idFactory: () => string = ulid,
): PersistableEntry | null {
	const resourceId = toResourceId(event.content.id);
	if (!resourceId) return null;

	return {
		id: idFactory(),
		entry: {
			timestamp: now.toISOString(),
			action: event.isNew ? "create" : "update",
			collection: event.collection,
			resourceId,
			resourceType: "content",
			metadata: extractMetadata(event.content),
		},
	};
}

export function buildEntryFromAfterDelete(
	event: ContentDeleteEvent,
	now: Date = new Date(),
	idFactory: () => string = ulid,
): PersistableEntry | null {
	const resourceId = toResourceId(event.id);
	if (!resourceId) return null;

	return {
		id: idFactory(),
		entry: {
			timestamp: now.toISOString(),
			action: "delete",
			collection: event.collection,
			resourceId,
			resourceType: "content",
		},
	};
}

export async function recordEntry(ctx: PluginContext, entry: PersistableEntry): Promise<void> {
	await getEntriesStorage(ctx).put(entry.id, entry.entry);
	await rememberCollection(ctx, entry.entry.collection);
}

export function getRetentionCutoff(retentionDays: number, now: Date = new Date()): string | null {
	if (retentionDays <= 0) return null;
	return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function maybeSweepExpiredEntries(
	ctx: PluginContext,
	cutoff: string | null,
	now: Date = new Date(),
): Promise<{ ran: boolean; deleted: number; lastSweepAt: string | null }> {
	if (!cutoff) {
		return { ran: false, deleted: 0, lastSweepAt: await getLastSweepAt(ctx) };
	}

	const previousSweepAt = await getLastSweepAt(ctx);
	if (previousSweepAt) {
		const previousSweep = new Date(previousSweepAt);
		if (!Number.isNaN(previousSweep.getTime())) {
			const elapsed = now.getTime() - previousSweep.getTime();
			if (elapsed >= 0 && elapsed < RETENTION_SWEEP_INTERVAL_MS) {
				return { ran: false, deleted: 0, lastSweepAt: previousSweepAt };
			}
		}
	}

	const expired = await getEntriesStorage(ctx).query({
		where: { timestamp: { lt: cutoff } },
		orderBy: { timestamp: "asc" },
		limit: RETENTION_SWEEP_BATCH_SIZE,
	});

	let deleted = 0;
	if (expired.items.length > 0) {
		deleted = await getEntriesStorage(ctx).deleteMany(expired.items.map((item) => item.id));
	}

	const lastSweepAt = now.toISOString();
	await ctx.kv.set(STATE_LAST_RETENTION_SWEEP_AT_KEY, lastSweepAt);

	return { ran: true, deleted, lastSweepAt };
}

function buildTimestampWhere(filters: HistoryFilters, cutoff: string | null): RangeWhere | undefined {
	const gte = laterOf(cutoff ?? undefined, filters.from);
	const lte = filters.to;
	if (!gte && !lte) return undefined;
	return {
		...(gte ? { gte } : {}),
		...(lte ? { lte } : {}),
	};
}

function buildListWhere(filters: HistoryFilters, cutoff: string | null): WhereClause | undefined {
	const where: WhereClause = {};
	if (filters.collection) where.collection = filters.collection;
	if (filters.action) where.action = filters.action;

	const timestamp = buildTimestampWhere(filters, cutoff);
	if (timestamp) where.timestamp = timestamp;

	return Object.keys(where).length > 0 ? where : undefined;
}

function buildAdminPath(entry: SimpleHistoryEntry): string {
	return `/_emdash/admin/content/${encodeURIComponent(entry.collection)}/${encodeURIComponent(entry.resourceId)}`;
}

export async function getHistoryList(
	ctx: PluginContext,
	request: unknown,
	now: Date = new Date(),
): Promise<HistoryListResponse> {
	const settings = await loadSettings(ctx);
	const normalizedRequest = normalizeHistoryListRequest(request, settings.maxPageSize, now);
	const cutoff = getRetentionCutoff(settings.retentionDays, now);

	const sweepResult = await maybeSweepExpiredEntries(ctx, cutoff, now);
	const result = await getEntriesStorage(ctx).query({
		where: buildListWhere(normalizedRequest.filters, cutoff),
		orderBy: { timestamp: "desc" },
		limit: normalizedRequest.limit,
		cursor: normalizedRequest.cursor,
	});

	return {
		items: result.items.map((item) => ({
			id: item.id,
			data: item.data,
			adminPath: buildAdminPath(item.data),
		})),
		nextCursor: result.cursor,
		hasMore: result.hasMore,
		appliedFilters: normalizedRequest.filters,
		pageSize: normalizedRequest.limit,
		retention: buildRetentionInfo(settings, cutoff, sweepResult.lastSweepAt),
	};
}

async function countForTimestampWindow(
	entries: StorageCollection<SimpleHistoryEntry>,
	cutoff: string | null,
	windowStart: string,
): Promise<number> {
	return entries.count({
		timestamp: {
			gte: laterOf(cutoff ?? undefined, windowStart)!,
		},
	});
}

export async function getHistorySummary(
	ctx: PluginContext,
	now: Date = new Date(),
): Promise<HistorySummaryResponse> {
	const settings = await loadSettings(ctx);
	const cutoff = getRetentionCutoff(settings.retentionDays, now);
	const sweepResult = await maybeSweepExpiredEntries(ctx, cutoff, now);
	const entries = getEntriesStorage(ctx);
	const baseWhere = buildListWhere({ window: "all" }, cutoff);

	const [retained, createCount, updateCount, deleteCount, knownCollections] = await Promise.all([
		entries.count(baseWhere),
		entries.count({ ...(baseWhere ?? {}), action: "create" }),
		entries.count({ ...(baseWhere ?? {}), action: "update" }),
		entries.count({ ...(baseWhere ?? {}), action: "delete" }),
		loadKnownCollections(ctx),
	]);

	const [last24h, last7d, last30d] = await Promise.all([
		countForTimestampWindow(entries, cutoff, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()),
		countForTimestampWindow(entries, cutoff, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()),
		countForTimestampWindow(entries, cutoff, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()),
	]);

	const visibleCollections = [...new Set([...knownCollections, ...settings.trackedCollections])].sort();
	const limitedCollections = visibleCollections.slice(0, MAX_SUMMARY_COLLECTIONS);
	const collectionCounts = await Promise.all(
		limitedCollections.map(async (collection) => ({
			collection,
			count: await entries.count({ ...(baseWhere ?? {}), collection }),
		})),
	);

	return {
		totals: {
			retained,
			create: createCount,
			update: updateCount,
			delete: deleteCount,
		},
		windows: {
			last24h,
			last7d,
			last30d,
		},
		collections: collectionCounts
			.filter((entry) => entry.count > 0)
			.sort((left, right) => right.count - left.count || left.collection.localeCompare(right.collection)),
		knownCollections: visibleCollections,
		retention: buildRetentionInfo(settings, cutoff, sweepResult.lastSweepAt),
		widget: {
			showWidget: settings.showWidget,
		},
	};
}
