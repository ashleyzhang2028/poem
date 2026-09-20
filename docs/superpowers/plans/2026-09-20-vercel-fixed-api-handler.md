# Vercel Fixed API Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every production `/api/*` request through a literal Vercel function instead of the unreachable dynamic function.

**Architecture:** `vercel.json` captures the public API suffix in `__path` and sends it to `api/handler.js`. The handler removes that private routing parameter, reconstructs the public URL for the existing route table, and dispatches without changing route modules.

**Tech Stack:** Vercel Functions, Node.js, existing custom HTTP tests

---

### Task 1: Pin the fixed routing contract

**Files:**
- Modify: `test/api.test.js`

- [ ] Expect the sole function entry to be `handler.js`.
- [ ] Expect the rewrite destination to be `/api/handler?__path=:path*`.
- [ ] Exercise the rewritten URL shape through the real HTTP handler.
- [ ] Run `node test/api.test.js` and confirm it fails because `api/handler.js` does not exist.

### Task 2: Implement the literal function entry

**Files:**
- Create: `api/handler.js`
- Delete: `api/[...path].js`
- Modify: `vercel.json`

- [ ] Move the API entry to `api/handler.js`.
- [ ] Resolve `__path` as the original public API path while retaining other query parameters.
- [ ] Rewrite `/api/:path*` to `/api/handler?__path=:path*`.
- [ ] Run `node test/api.test.js` and confirm it passes.

### Task 3: Update entry references and validate

**Files:**
- Modify: tests, operational guidance, and architecture documentation that name the old entry.

- [ ] Replace executable imports and deployment checks with `api/handler.js`.
- [ ] Update documentation to describe the literal handler and captured path.
- [ ] Run the focused routing and deployment tests.
- [ ] Run `npm test` and confirm the full suite passes.
