# emdash-simple-history

Simple History is a focused activity feed for EmDash CMS. It records content create, update, and delete events, then surfaces them in an admin history page and a dashboard widget so operators can quickly answer: **what changed, and roughly when?**

It is intentionally narrower than a compliance-grade audit product.

## Features

- Records content lifecycle events with timestamps, action, collection, and resource identity
- Recent Activity dashboard widget for a quick operational pulse
- Dedicated `/history` admin page with:
  - collection filtering
  - action filtering
  - rolling windows and custom date ranges
  - pagination
  - empty states
  - retention summary
- Retention controls and tracked-collection controls stored in plugin KV
- Standard-format plugin architecture for trusted or sandboxed EmDash installs
- Private-only admin data routes backed by plugin storage

## Installation

```bash
pnpm add emdash-simple-history
```

Register it in your EmDash config:

```ts
import { defineConfig } from "astro/config";
import { emdash } from "emdash/astro";
import { simpleHistoryPlugin } from "emdash-simple-history";

export default defineConfig({
	integrations: [
		emdash({
			plugins: [simpleHistoryPlugin()],
			// or sandboxed: [simpleHistoryPlugin()]
		}),
	],
});
```

## What it captures

Each entry contains:

- `timestamp`
- `action` (`create`, `update`, `delete`)
- `collection`
- `resourceId`
- `resourceType`
- optional `metadata` (`title`, `slug`, `status`) when available

## Admin UX

### Dashboard widget

The widget highlights recent activity and short rolling-window counts.

### History page

The plugin registers a `/history` admin page that combines:

- summary stats
- top active collections
- filter controls
- paginated activity table
- settings for retention, tracked collections, widget visibility, and page size

## Settings

Simple History currently stores settings in the history page itself instead of a separate generated settings screen.

Available settings:

- `retentionDays` — `0` means keep entries forever
- `trackedCollections` — comma-separated collection slugs; empty means capture all collections
- `showWidget` — enables or disables the dashboard widget's content
- `maxPageSize` — hard cap for route and page pagination

## Private plugin routes

All routes are private and mounted under `/_emdash/api/plugins/simple-history/`.

### `history/list`

`POST /_emdash/api/plugins/simple-history/history/list`

Request body:

```json
{
	"filters": {
		"collection": "posts",
		"action": "update",
		"window": "7d"
	},
	"limit": 25,
	"cursor": "optional-cursor"
}
```

Response data includes paginated `items`, `nextCursor`, `hasMore`, the normalized filters, and retention metadata.

### `history/summary`

`POST /_emdash/api/plugins/simple-history/history/summary`

Returns retained totals, rolling-window counts, known collections, and widget state.

> EmDash wraps successful plugin route responses in the normal `{ data: ... }` envelope.

## Marketplace / bundling

This package is structured for EmDash's plugin bundling flow:

```bash
pnpm build
emdash plugin bundle
emdash plugin publish --tarball dist/simple-history-0.1.0.tar.gz
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Limitations

- This is activity history, not a forensic audit trail
- Actor attribution is intentionally omitted in v1
- Only content create/update/delete events are included in v1
- Tracked collection changes affect future captures only; they do not backfill historical data
- Standard plugins cannot dynamically unregister dashboard widgets at runtime, so a disabled widget renders a disabled state instead of disappearing entirely
- Current standard Block Kit tables do not provide a direct per-row deep-link affordance here, so the plugin surfaces collection and resource identity for fast lookup via the admin command palette/search

## License

MIT
