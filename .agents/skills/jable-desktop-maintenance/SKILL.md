---
name: jable-desktop-maintenance
description: "Use for Jable Desktop maintenance work: no-spec-change refactors, architecture boundary decisions, adding or moving modules, choosing validation commands, and keeping repo docs/tests aligned without over-engineering."
---

# Jable Desktop Maintenance

Use this skill when working in the Jable Desktop repo on implementation, refactor, architecture cleanup, module moves, or validation planning. This is a repo-scoped team skill, so keep guidance portable for all contributors and avoid user-specific paths, credentials, local aliases, or machine-only assumptions.

## Workflow

1. Read the nearest relevant source files before deciding where to edit.
2. Decide placement before implementation:
   - Extend an existing file when the change fits that file's current responsibility and keeps it cohesive.
   - Create a new file only for a clear domain/runtime concern, side-effect boundary, external dependency boundary, or readability win.
   - Put new files in the nearest existing domain folder before adding root-level siblings.
   - Add a new subdirectory only when related files form a small subsystem with a composition point, internal helpers, and a stable public entrypoint.
3. Keep behavior stable unless the user explicitly asks for a behavior change.
4. Avoid abstraction unless it reduces cognitive load now. Prefer explicit readable code over speculative indirection.
5. Keep comments high-value. Add or update comments only when they explain safety invariants, async races, platform/framework limits, performance tradeoffs, API/IPC caveats, ownership/concurrency rationale, or domain intent that code structure cannot express clearly.
6. Do not add comments that repeat assignments, function names, branch conditions, type/interface fields, or behavior already obvious from names and IDE hover.
7. When moving modules, update imports, tests, generated-runtime test paths, and architecture docs in the same change.
8. Self-review before finalizing: check stale paths, ownership drift, accidental behavior changes, missing tests, and missing high-value comments around newly introduced sync, download, browser, filesystem, IPC, migration, or async state behavior.

## Repo Anchors

- Use `docs/refactor-opportunities.md` as the starting point for continued no-spec-change optimization.
- Keep `app/main.ts` as the Electron main-process composition root.
- Keep embedded browser main-process runtime modules under `app/main-process/browser/`.
- Keep download pipeline internals under `app/main-process/download/`; keep app-level download quit/window-close gating at its app boundary unless there is a larger app-lifecycle grouping.
- Keep HLS playback internals under `app/main-process/hls-playback/`.
- Keep local playback internals under `app/main-process/local-playback/`.
- Keep renderer-to-main contracts in `app/types/jable.ts`, `app/preload.ts`, main IPC handlers, renderer call sites, and tests aligned.
- Keep user-facing copy in all locale files under `app/i18n/locales/`.

## Validation Selection

Choose the smallest validation set that covers the touched behavior:

- Main-process TypeScript or module moves: `fnm exec --using 24 npm run typecheck:electron`, then `fnm exec --using 24 npm run build:electron` when Node tests require `app/runtime-dist/`.
- Renderer or Vue changes: `fnm exec --using 24 npm run typecheck:renderer`; add `fnm exec --using 24 npm run test:renderer` for behavior or component changes.
- Formatting-sensitive files: `fnm exec --using 24 npm run format:check`.
- General JS/TS changes: `fnm exec --using 24 npm run lint`.
- Rust data-engine changes: `fnm exec --using 24 npm run rust:test` or `fnm exec --using 24 npm run rust:ci`.
- IPC, Electron startup, BrowserWindow/WebContentsView bootstrapping, preload bridge, protocol/session setup: consider `fnm exec --using 24 npm run test:electron`.

Report any skipped validation and why.
