---
title: "PRD: EmDash Simple History"
status: draft
priority: P2
inspired_by: "Simple History"
plugin_id: "simple-history"
package_name: "@emdash-cms/plugin-simple-history"
execution_mode: "Standard plugin, sandbox-compatible target"
---

# PRD: EmDash Simple History

## Product summary

EmDash Simple History gives operators a lightweight activity stream for content lifecycle events. It is intentionally narrower than a full compliance-grade audit system. The product should answer the everyday question: **what changed, and roughly when?**

This PRD positions the plugin as a practical admin-facing history tool, not as a forensic security system.

## Problem

Operators and editors need visibility into recent activity:

- what content was created,
- what was updated,
- what was deleted,
- which collections are most active,
- when changes happened.

Without an activity feed, the admin experience feels opaque, especially on collaborative sites.

EmDash already has the right primitives for this style of plugin:

- `content:afterSave`
- `content:afterDelete`
- plugin-scoped storage with indexes
- admin pages and widgets

## Goals

1. Log a clean stream of content lifecycle events.
2. Make recent activity visible in the admin dashboard.
3. Support filtering by collection, action, and time.
4. Keep the MVP operationally modest and easy to reason about.
5. Stay compatible with sandboxed deployment where practical.

## Non-goals

- Full compliance audit logging
- Guaranteed before/after diffs for every field
- Media, auth, and infrastructure events in v1
- Cross-plugin event ingestion
- Public-facing history pages

## Primary users

### Editors and admins
They want to know what changed recently without digging through content lists.

### Site operators
They want a quick operational pulse on the site.

## Key user stories

1. As an admin, I can see recent content activity in a dashboard widget.
2. As an operator, I can open a full history page and filter events by collection.
3. As a team lead, I can understand whether a site has been actively updated this week.
4. As a site owner, I can define how long history entries are retained.
5. As an editor, I can confirm that a delete or update event was recorded.

## MVP scope

### In scope

- content create and update logging
- content delete logging
- admin dashboard widget for recent events
- admin history page with filters
- retention settings
- storage-backed queryable entries
- private plugin routes for admin UI data fetching

### Out of scope

- detailed field diffs
- public routes
- media lifecycle tracking in v1
- export pipelines beyond simple CSV in a later phase
- alerting and notifications

## Functional requirements

### Event capture

The plugin must record at least:

- timestamp
- action (`create`, `update`, `delete`)
- collection
- resource ID
- optional metadata blob for future enrichment

### Admin widget

The dashboard widget must show a small recent-activity list with links back into the relevant content item when possible.

### History page

The history page must support:

- filter by collection
- filter by action
- date-range or recent-window filter
- pagination
- empty state
- retention summary

### Retention

Admins must be able to define retention days. The plugin may use a scheduled cleanup task in a later phase if needed, but v1 can also do lazy cleanup from admin reads if that is operationally simpler.

## UX and integration model

This is an admin-first plugin.

Core surfaces:

- dashboard widget for “what happened recently”
- full page for browsing history

There is no public frontend feature in v1.

## Technical approach for EmDash

### Plugin surfaces

- `storage`
- `admin.settingsSchema`
- `admin.pages`
- `admin.widgets`
- `content:afterSave`
- `content:afterDelete`
- private plugin routes for admin filtering

### Capabilities

`read:content`

That matches the current content hooks model and keeps the feature narrow.

### Storage model

Collection: `entries`

Suggested indexes:

- `timestamp`
- `action`
- `collection`
- `["collection", "timestamp"]`
- `["action", "timestamp"]`

### Routes

Private only:

- `history/list`
- `history/summary`

No public routes.

### Settings

- `settings:retentionDays`
- `settings:trackedCollections`
- `settings:showWidget`

## Data shape

Each entry should include:

- `timestamp`
- `action`
- `collection`
- `resourceId`
- `resourceType`
- `metadata`

Actor attribution can be added later if the necessary runtime context is available consistently.

## Success metrics

- Saves and deletes generate visible entries.
- Operators can filter activity quickly enough to answer common “what changed?” questions.
- The plugin stays narrow enough to remain maintainable.

## Risks and mitigations

### Risk: users expect compliance-grade auditing
Mitigation: market the product as activity history, not a security audit trail.

### Risk: actor identity may not be available consistently
Mitigation: keep actor fields optional and avoid promising them in MVP acceptance.

### Risk: storage growth
Mitigation: retention settings and cleanup plan.

## Milestones

1. Implement storage and content hooks.
2. Build recent-activity widget.
3. Build full history page and private routes.
4. Add retention controls.
5. QA on busy and quiet editorial sites.

## Acceptance criteria

- Create, update, and delete events are stored.
- Admins can view a recent-activity widget.
- Admins can browse filtered history on a dedicated page.
- All routes are private.
- The plugin uses plugin storage with declared indexes.

## Open questions

1. Should lazy cleanup be acceptable for v1, or do we want scheduled cleanup immediately?
2. Do we want media events in v1.1 or a separate companion plugin?
3. Should there be a CSV export route for operators in the first admin release?
