# Changelog

## 0.2.0

- Require EmDash 1.0.1 or later; existing 0.1.x npm installs can stay on their current release.
- Add the current sandbox registry manifest and pinned plugin CLI.
- Publish self-contained runtime artifacts while preserving the npm descriptor factory.
- Validate route input inside the sandbox.

## 0.1.2

- Added admin route support for `/settings` as an alias to the existing `/history` page to prevent settings-page load failures in host admin UIs.

## 0.1.1

- Added package-level plugin identity metadata and explicit no-network manifest metadata for marketplace trust review.

## 0.1.0

- Initial release of EmDash Simple History
- Added content create, update, and delete event capture
- Added admin history page with filters, retention summary, and settings
- Added recent activity dashboard widget
- Added private list and summary routes for admin data access
- Added unit and runtime tests for core behavior
