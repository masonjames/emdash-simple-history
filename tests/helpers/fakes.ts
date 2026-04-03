import type { PluginContext, StorageCollection, StandardPluginDefinition } from "emdash";

import type { SimpleHistoryEntry } from "../../src/types.js";

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

type QueryOptions = {
	where?: WhereClause;
	orderBy?: Record<string, "asc" | "desc">;
	limit?: number;
	cursor?: string;
};

const DEFAULT_ENTRY_INDEXES: Array<string | string[]> = [
	"timestamp",
	"action",
	"collection",
	["collection", "timestamp"],
	["action", "timestamp"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareValues(left: unknown, right: unknown): number {
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}
	return String(left ?? "").localeCompare(String(right ?? ""));
}

function matchesWhere(data: Record<string, unknown>, where?: WhereClause): boolean {
	if (!where) return true;

	for (const [field, expected] of Object.entries(where)) {
		const actual = data[field];

		if (isRecord(expected)) {
			if ("in" in expected) {
				const options = Array.isArray(expected.in) ? expected.in : [];
				if (!options.some((value) => value === actual)) return false;
				continue;
			}

			if ("startsWith" in expected) {
				if (typeof actual !== "string" || !actual.startsWith(String(expected.startsWith))) return false;
				continue;
			}

			if (expected.gt !== undefined && compareValues(actual, expected.gt) <= 0) return false;
			if (expected.gte !== undefined && compareValues(actual, expected.gte) < 0) return false;
			if (expected.lt !== undefined && compareValues(actual, expected.lt) >= 0) return false;
			if (expected.lte !== undefined && compareValues(actual, expected.lte) > 0) return false;
			continue;
		}

		if (actual !== expected) return false;
	}

	return true;
}

function encodeCursor(offset: number): string {
	return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
	if (!cursor) return 0;
	const parsed = Number(Buffer.from(cursor, "base64url").toString("utf8"));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export class InMemoryKV {
	private readonly map = new Map<string, unknown>();

	constructor(initial: Record<string, unknown> = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.map.set(key, value);
		}
	}

	async get<T>(key: string): Promise<T | null> {
		return (this.map.has(key) ? (this.map.get(key) as T) : null) ?? null;
	}

	async set(key: string, value: unknown): Promise<void> {
		this.map.set(key, value);
	}

	async delete(key: string): Promise<boolean> {
		return this.map.delete(key);
	}

	async list(prefix = ""): Promise<Array<{ key: string; value: unknown }>> {
		return [...this.map.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, value]) => ({ key, value }));
	}
}

export class InMemoryStorage<T extends object> implements StorageCollection<T> {
	private readonly map = new Map<string, T>();
	private readonly indexedFields: Set<string>;

	constructor(indexes: Array<string | string[]>) {
		this.indexedFields = new Set(indexes.flatMap((entry) => (Array.isArray(entry) ? entry : [entry])));
	}

	private validateQuery(options?: QueryOptions): void {
		for (const field of Object.keys(options?.where ?? {})) {
			if (!this.indexedFields.has(field)) {
				throw new Error(`Query attempted to filter on non-indexed field "${field}".`);
			}
		}

		for (const field of Object.keys(options?.orderBy ?? {})) {
			if (!this.indexedFields.has(field)) {
				throw new Error(`Query attempted to order by non-indexed field "${field}".`);
			}
		}
	}

	private rows(options?: QueryOptions): Array<{ id: string; data: T }> {
		this.validateQuery(options);

		const rows = [...this.map.entries()]
			.map(([id, data]) => ({ id, data }))
			.filter((entry) => matchesWhere(entry.data as Record<string, unknown>, options?.where));

		const orderBy = options?.orderBy ?? {};
		const orderEntries = Object.entries(orderBy);
		if (orderEntries.length > 0) {
			rows.sort((left, right) => {
				for (const [field, direction] of orderEntries) {
					const leftRecord = left.data as Record<string, unknown>;
					const rightRecord = right.data as Record<string, unknown>;
					const comparison = compareValues(leftRecord[field], rightRecord[field]);
					if (comparison !== 0) {
						return direction === "asc" ? comparison : -comparison;
					}
				}
				return left.id.localeCompare(right.id);
			});
		}

		return rows;
	}

	toArray(): Array<{ id: string; data: T }> {
		return [...this.map.entries()].map(([id, data]) => ({ id, data }));
	}

	async get(id: string): Promise<T | null> {
		return this.map.get(id) ?? null;
	}

	async put(id: string, data: T): Promise<void> {
		this.map.set(id, data);
	}

	async delete(id: string): Promise<boolean> {
		return this.map.delete(id);
	}

	async exists(id: string): Promise<boolean> {
		return this.map.has(id);
	}

	async getMany(ids: string[]): Promise<Map<string, T>> {
		const result = new Map<string, T>();
		for (const id of ids) {
			const item = this.map.get(id);
			if (item) result.set(id, item);
		}
		return result;
	}

	async putMany(items: Array<{ id: string; data: T }>): Promise<void> {
		for (const item of items) {
			this.map.set(item.id, item.data);
		}
	}

	async deleteMany(ids: string[]): Promise<number> {
		let deleted = 0;
		for (const id of ids) {
			if (this.map.delete(id)) deleted += 1;
		}
		return deleted;
	}

	async query(options?: QueryOptions): Promise<{ items: Array<{ id: string; data: T }>; cursor?: string; hasMore: boolean }> {
		const rows = this.rows(options);
		const start = decodeCursor(options?.cursor);
		const limit = options?.limit ?? 50;
		const items = rows.slice(start, start + limit);
		const nextOffset = start + items.length;
		const hasMore = nextOffset < rows.length;
		return {
			items,
			cursor: hasMore ? encodeCursor(nextOffset) : undefined,
			hasMore,
		};
	}

	async count(where?: WhereClause): Promise<number> {
		return this.rows({ where }).length;
	}
}

export function createTestPluginContext(initialKv: Record<string, unknown> = {}) {
	const kv = new InMemoryKV(initialKv);
	const entries = new InMemoryStorage<SimpleHistoryEntry>(DEFAULT_ENTRY_INDEXES);
	const logs = {
		info: [] as string[],
		warn: [] as string[],
		error: [] as string[],
	};

	const ctx = {
		plugin: { id: "simple-history", version: "0.1.0" },
		storage: { entries },
		kv,
		log: {
			info: (message: string) => logs.info.push(message),
			warn: (message: string) => logs.warn.push(message),
			error: (message: string, error?: unknown) =>
				logs.error.push(error instanceof Error ? `${message}: ${error.message}` : message),
		},
	} as unknown as PluginContext;

	return { ctx, kv, entries, logs };
}

export async function invokeStandardRoute(
	definition: StandardPluginDefinition,
	routeName: string,
	ctx: PluginContext,
	body?: unknown,
) {
	const route = definition.routes?.[routeName] as
		| { input?: { parse(value: unknown): unknown }; handler: (routeCtx: unknown, ctx: PluginContext) => Promise<unknown> }
		| undefined;
	if (!route) throw new Error(`Unknown route ${routeName}`);
	const input = route.input ? route.input.parse(body) : body;
	return route.handler(
		{
			input,
			request: new Request(`http://example.test/${routeName}`, { method: "POST" }),
			requestMeta: { ip: null, userAgent: null, referer: null, geo: null },
		},
		ctx,
	);
}

export async function invokeStandardHook(
	definition: StandardPluginDefinition,
	hookName: string,
	event: unknown,
	ctx: PluginContext,
) {
	const hook = definition.hooks?.[hookName];
	if (!hook) throw new Error(`Unknown hook ${hookName}`);
	if (typeof hook === "function") {
		return hook(event, ctx);
	}
	if (typeof hook === "object" && hook !== null && "handler" in hook && typeof hook.handler === "function") {
		return hook.handler(event, ctx);
	}
	throw new Error(`Hook ${hookName} has an unsupported shape.`);
}
