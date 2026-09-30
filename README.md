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

Requires EmDash 1.0.1 or later. Install **Simple History** by `@masonjames.com`
from the [EmDash plugin registry](https://plugins.emdashcms.com). Your site must
have a sandbox runner configured. Open Plugins → History after installation.
There is no frontend package or theme change to make.

Existing npm users can continue with:

```bash
pnpm add emdash-simple-history
```

```ts
import { defineConfig } from "astro/config";
import { emdash } from "emdash/astro";
import { simpleHistoryPlugin } from "emdash-simple-history";

export default defineConfig({
  integrations: [emdash({ plugins: [simpleHistoryPlugin()] })],
});
```

The npm factory remains supported. For isolated npm registration, configure your
sandbox runner and use `sandboxed: [simpleHistoryPlugin()]`. Choose one install
method; do not enable the npm and registry versions together. Existing npm
history remains under `simple-history`; registry installations have a separate
publisher-scoped identity and do not import that history automatically.

The registry version requests `content:read` and no external network hosts.
It stores history and settings in its own plugin storage and KV. Activity routes
are private, so site visitors cannot read the feed.

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

## Build, test, and release

```bash
pnpm install --frozen-lockfile
pnpm check
```

`check` builds the self-contained runtime, typechecks, runs unit tests and a real
EmDash sandbox integration test, and validates the registry bundle. The sandbox
check covers content create/update/delete, persistence after restart, private
routes, invalid filters, and Block Kit admin pages/widgets.

The sandbox test approach follows EmDash's official `@emdash-cms/plugin-test`
host, also used by [Charl Kruger's EmDash Forms](https://github.com/charl-kruger/emdash-forms).

Publish the verified version after committing and pushing its source:

```bash
pnpm exec emdash-plugin login masonjames.com
pnpm exec emdash-plugin publish
pnpm publish --access public
```

Publishing creates package and release records in the publisher's Atmosphere
account. The catalog becomes visible after approval; follow the CLI's
`emdash-plugin info … --version … --watch` command to check that state.
The CLI is pinned to `0.13.1`. Published versions are immutable.

## Limitations

- This is activity history, not a forensic audit trail
- Actor attribution is intentionally omitted in v1
- Only content create/update/delete events are included in v1
- Tracked collection changes affect future captures only; they do not backfill historical data
- Standard plugins cannot dynamically unregister dashboard widgets at runtime, so a disabled widget renders a disabled state instead of disappearing entirely
- Current standard Block Kit tables do not provide a direct per-row deep-link affordance here, so the plugin surfaces collection and resource identity for fast lookup via the admin command palette/search

## License

MIT
