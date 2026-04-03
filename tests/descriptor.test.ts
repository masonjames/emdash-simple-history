import { describe, expect, it } from "vitest";

import { simpleHistoryPlugin } from "../src/index.js";

describe("descriptor", () => {
	it("matches the expected standard plugin shape", () => {
		const descriptor = simpleHistoryPlugin();
		expect(descriptor.id).toBe("simple-history");
		expect(descriptor.version).toBe("0.1.0");
		expect(descriptor.format).toBe("standard");
		expect(descriptor.entrypoint).toBe("@emdash-cms/plugin-simple-history/sandbox");
		expect(descriptor.capabilities).toEqual(["read:content"]);
		expect(descriptor.adminPages).toEqual([{ path: "/history", label: "History", icon: "history" }]);
		expect(descriptor.adminWidgets).toEqual([{ id: "recent-activity", title: "Recent Activity", size: "half" }]);
		expect(descriptor.storage?.entries?.indexes).toEqual([
			"timestamp",
			"action",
			"collection",
			["collection", "timestamp"],
			["action", "timestamp"],
		]);
	});
});
