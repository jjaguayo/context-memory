# Requirements: Shared Memory Layer with Personal Override

> **Status:** Implemented  
> **Authors:** Technical PM + Principal Engineer  
> **Date:** 2026-04-12  
> **Idea reference:** `PRODUCT_IDEAS.md` — Idea 2  
> **Depends on:** Idea 1 (Team Memory Profiles) — must be implemented first  
> **Implementation phase:** Growth (extends infra, adds `promote_memory` tool)

---

## 1. Overview

Today every memory is private to the developer who stored it. Knowledge that would benefit the whole team — architectural decisions, API contracts, hard-won gotchas — has no path out of a single session. The only option is manual copy-paste, which nobody does consistently.

Idea 2 introduces a **two-tier memory model**: a **personal layer** (local Qdrant, current behaviour) and an optional **shared layer** (team-deployed Qdrant, configured via `QDRANT_SHARED_URL`). Promotion from personal to shared is always a deliberate act — either explicit via the new `promote_memory` tool or automatic when a stored memory's tags match the `auto_promote_tags` list in the active profile. `search_memories` queries both layers and returns results interleaved by relevance score, each labelled with its source. The entire shared layer is opt-in: teams that don't configure `QDRANT_SHARED_URL` see no change at all.

---

## 2. Goals

- Enable team members to deliberately share high-value memories to a common knowledge base.
- Surface shared memories alongside personal ones in every search, ranked by relevance.
- Allow profile-driven automation: memories tagged with `auto_promote_tags` are promoted without a manual step.
- Degrade gracefully at every level: no shared URL → personal-only; shared layer down → personal fallback with stderr warning.
- Introduce no breaking changes for solo contributors or existing deployments.

---

## 3. Non-Goals

The following are explicitly out of scope for this idea:

- **Writing directly to shared** — `remember_info` always writes to the personal layer. There is no `scope: "shared"` parameter on `remember_info`. Shared is populated only via promotion.
- **Move semantics on promotion** — promoting a memory keeps the personal copy. Deletion from personal after promotion is not supported in this phase.
- **Conflict detection** — if two team members store contradicting memories on the shared layer, last write wins. Surfacing conflicts is deferred to Idea 3 (provenance and `memory_health`).
- **Access control on the shared Qdrant instance** — authentication and authorisation on the shared Qdrant are the team's infrastructure responsibility. The MCP server connects with the URL as given.
- **Cross-project promotion** — `promote_memory` copies a memory with its original `projectId`. Changing the project scope during promotion is not supported.
- **Bulk promotion** — `promote_memory` operates on a single memory ID per call. Batch promotion is not in scope.

---

## 4. User Stories

### Persona A — Team Lead (configures the standard and infrastructure)

| ID | Story |
|---|---|
| TL-1 | As a team lead, I want to deploy a shared Qdrant instance and point the team's MCP servers at it via `QDRANT_SHARED_URL` so that promoted memories are available to all team members. |
| TL-2 | As a team lead, I want to define `auto_promote_tags` in `profile.yml` so that memories tagged with `architecture` or `api-contract` are automatically shared without requiring a manual promote step. |
| TL-3 | As a team lead, I want new team members to immediately benefit from the shared knowledge base by simply configuring `QDRANT_SHARED_URL` — no manual import or sync required. |

### Persona B — Team Member (uses the shared layer day-to-day)

| ID | Story |
|---|---|
| TM-1 | As a team member, I want to call `promote_memory` on a memory I stored so that my teammates can find it in their searches. |
| TM-2 | As a team member, I want `search_memories` to return relevant results from both my personal memories and the shared knowledge base, ranked by how relevant they are — not by which layer they came from. |
| TM-3 | As a team member, I want each search result to tell me whether it came from my personal layer or the shared layer so I know how broadly applicable the context is. |
| TM-4 | As a team member, I want `remember_info` to automatically promote memories to shared when my tags match `auto_promote_tags`, so I don't have to remember to run a separate command. |
| TM-5 | As a team member, I want to delete a shared memory I promoted by mistake using `forget_memory` with an explicit scope, without accidentally deleting my personal copy. |

### Persona C — New Team Member (onboards via shared layer)

| ID | Story |
|---|---|
| NTM-1 | As a new team member, I want to set `QDRANT_SHARED_URL` and immediately find the team's accumulated architectural decisions and known gotchas in my search results. |
| NTM-2 | As a new team member, I want my personal memories to continue working normally even if the shared Qdrant instance is temporarily unavailable. |

---

## 5. Functional Requirements

### 5.1 Qdrant Client Setup

| ID | Requirement |
|---|---|
| F-01 | A `sharedQdrant` client MUST be initialised from `QDRANT_SHARED_URL` if that environment variable is set. |
| F-02 | If `QDRANT_SHARED_URL` is not set, `sharedQdrant` MUST be `null`. All shared-layer features MUST degrade gracefully to no-ops when `sharedQdrant` is `null`. |
| F-03 | `sharedQdrant` and the existing `qdrant` (personal) client MUST be exported from `src/lib/qdrant.ts`. |
| F-04 | A new `ensureSharedCollection()` function MUST be implemented alongside the existing `ensureCollection()`. It MUST create the `memories` collection on the shared Qdrant instance if it does not already exist, using the same vector size (384) and distance metric (Cosine) as the personal collection. |
| F-05 | `ensureSharedCollection()` MUST be a no-op (and not throw) when `sharedQdrant` is `null`. |

### 5.2 Server Startup

| ID | Requirement |
|---|---|
| F-06 | `src/index.ts` MUST call `ensureSharedCollection()` during startup, after `ensureCollection()`. |
| F-07 | If `QDRANT_SHARED_URL` is set and the shared collection is initialised successfully, the server MUST log to stderr: `[shared] Connected to shared layer at <url>`. |
| F-08 | If `QDRANT_SHARED_URL` is not set, the server MUST NOT log any message about the shared layer (silent no-op). |
| F-09 | A failure to connect to the shared Qdrant instance at startup MUST log a warning to stderr but MUST NOT crash the server. The server starts in personal-only mode. |
| F-10 | The `sharedQdrant` client (or `null`) and the active `MemoryProfile` (or `null`) MUST both be passed into `registerRememberTool()` and `registerSearchTool()` as parameters. `registerPromoteTool()` MUST receive `sharedQdrant`. `registerForgetTool()` MUST receive `sharedQdrant`. |

### 5.3 `remember_info` — Auto-Promotion

| ID | Requirement |
|---|---|
| F-11 | `remember_info` MUST continue to always write to the personal Qdrant layer. No `scope` parameter is added to `remember_info`. |
| F-12 | The Qdrant payload for every new memory MUST include a `scope` field set to `"personal"`. |
| F-13 | After a successful personal write, if both a profile is active AND `sharedQdrant` is not null AND the profile defines `auto_promote_tags`, `remember_info` MUST check whether any of the stored memory's tags intersect with `auto_promote_tags` (case-sensitive). |
| F-14 | If the intersection check in F-13 is true, `remember_info` MUST automatically promote the memory to the shared layer (same logic as `promote_memory`, see F-20 through F-25). |
| F-15 | When auto-promotion succeeds, the success message MUST indicate it: `"✅ Remembered for project \"<id>\" and auto-promoted to shared (tag: <matched_tag>): <preview>..."` |
| F-16 | If auto-promotion is triggered but `sharedQdrant` is null (profile has `auto_promote_tags` but env var not set), `remember_info` MUST log a warning to stderr and return a success message for the personal write only. It MUST NOT return `isError`. |
| F-17 | If auto-promotion fails due to a shared Qdrant error, `remember_info` MUST log a warning to stderr and return a success message for the personal write only. The personal memory is already stored; the auto-promotion failure MUST NOT retroactively fail the tool call. |

### 5.4 `promote_memory` — New Tool

| ID | Requirement |
|---|---|
| F-18 | A new MCP tool `promote_memory` MUST be implemented in `src/tools/promote.ts` and registered via `registerPromoteTool(server, sharedQdrant)`. |
| F-19 | `promote_memory` MUST accept a single required parameter: `memoryId` (string — the UUID of a personal memory). |
| F-20 | `promote_memory` MUST return `isError: true` with a clear message if `sharedQdrant` is null: `"Shared layer is not configured. Set QDRANT_SHARED_URL to enable promotion."` |
| F-21 | `promote_memory` MUST retrieve the full point (vector + payload) from the personal Qdrant by `memoryId`. |
| F-22 | If the memory is not found in the personal layer, `promote_memory` MUST return `isError: true`: `"Memory <id> not found in personal layer."` |
| F-23 | `promote_memory` MUST copy the memory to the shared Qdrant with a **new UUID** and the same vector and payload, with `scope` overridden to `"shared"`. |
| F-24 | The personal copy MUST remain untouched after promotion (copy semantics, not move). |
| F-25 | On success, `promote_memory` MUST return both the original personal ID and the new shared ID: `"✅ Memory <personal-id> promoted to shared layer (shared ID: <shared-id>) for project \"<projectId>\"."` |
| F-26 | `promote_memory` MUST return `isError: true` if the Qdrant retrieve or upsert operation throws. |

### 5.5 `search_memories` — Dual-Layer Query

| ID | Requirement |
|---|---|
| F-27 | When `sharedQdrant` is not null, `search_memories` MUST query both the personal and shared Qdrant instances in **parallel** (using `Promise.all` or equivalent). |
| F-28 | Results from both layers MUST be merged into a single list and sorted descending by cosine similarity score. |
| F-29 | Each result in the formatted output MUST be labelled with its source layer: `[personal]` or `[shared]`. |
| F-30 | The `limit` parameter MUST apply to the **merged** result list, not per-layer. Each layer MUST be queried with the full `limit` to ensure the top-N merged results are correct. |
| F-31 | If the shared Qdrant is unreachable during a search (network error, timeout), `search_memories` MUST catch the error, log a warning to stderr (`[shared] Unreachable — returning personal results only`), and return personal results only. It MUST NOT return `isError`. |
| F-32 | If `sharedQdrant` is null, `search_memories` MUST behave identically to its current behaviour (personal only, no labels). |
| F-33 | When both layers are queried, the `projectId` filter MUST be applied independently to each layer's query. |

### 5.6 `forget_memory` — Scope Extension

| ID | Requirement |
|---|---|
| F-34 | `forget_memory` MUST accept a new optional `scope` parameter: `"personal"` (default) \| `"shared"` \| `"all"`. |
| F-35 | When `scope` is `"personal"` (or omitted), behaviour is identical to today — delete from personal only. Backward compatible. |
| F-36 | When `scope` is `"shared"`, `forget_memory` MUST delete from the shared layer only. MUST return `isError: true` if `sharedQdrant` is null. |
| F-37 | When `scope` is `"all"`, `forget_memory` MUST attempt to delete from both layers. If the shared layer is unavailable, it MUST still delete from personal and return a partial success message noting the shared deletion failed. |
| F-38 | `forget_memory` with `scope: "shared"` or `"all"` accepts either `memoryId` (single shared point UUID) or `projectId` (all shared points for that project) — same semantics as personal deletion. |

### 5.7 Graceful Degradation

| ID | Requirement |
|---|---|
| F-39 | A deployment with no `QDRANT_SHARED_URL` set MUST behave byte-for-byte identically to the current Idea 1 implementation. No new errors, no new log lines, no performance change. |
| F-40 | A deployment with `QDRANT_SHARED_URL` set but the shared instance temporarily down MUST allow `remember_info`, `search_memories`, and `forget_memory` to continue operating on the personal layer without interruption. |
| F-41 | `promote_memory` is the only operation that MUST return `isError` when the shared layer is unavailable (F-20), because its sole purpose is to write to shared. |

---

## 6. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-01 | Personal and shared Qdrant queries in `search_memories` MUST be issued in parallel, not sequentially. Added latency when shared is configured should be bounded by the slower of the two queries, not the sum. |
| NF-02 | `promote_memory` requires a `retrieve` call followed by an `upsert`. The retrieved vector MUST be used as-is — no re-embedding. This keeps promotion fast and deterministic. |
| NF-03 | All new stderr log lines from shared-layer operations MUST be prefixed with `[shared]` for easy filtering. |
| NF-04 | The `sharedQdrant` client MUST be initialised once at startup and passed through the call stack. It MUST NOT be re-read from `process.env` on every tool call. |
| NF-05 | No new npm dependencies are required. The existing `@qdrant/js-client-rest` client supports multiple instances. |

---

## 7. Schema Reference

### 7.1 Updated Qdrant Payload

```typescript
{
  text: string;           // existing — the stored content
  projectId: string;      // existing — project scope (indexed)
  tags: string[];         // existing — keywords for categorization
  timestamp: string;      // existing — ISO 8601 creation time
  category?: string;      // Idea 1 — optional memory category
  scope: 'personal' | 'shared';  // NEW — which layer this memory lives in
}
```

`scope` is stored as metadata so that when a promoted memory is later retrieved, its origin is clear. Note: the physical Qdrant instance is authoritative for scope — a `scope: "shared"` record in the personal instance would indicate a data integrity issue, not a valid state.

### 7.2 `promote_memory` Tool Signature

```
promote_memory({ memoryId: string })
→ "✅ Memory <personal-id> promoted to shared layer (shared ID: <shared-id>) for project \"<projectId>\"."
```

### 7.3 Updated `search_memories` Output Format (shared configured)

```
[ID: abc-123] [personal] [Project: my-project] Auth service uses RS256 JWT tokens.
---
[ID: def-456] [shared]   [Project: my-project] Payments use idempotency keys to prevent duplicate charges.
---
[ID: ghi-789] [personal] [Project: my-project] Database uses UUID primary keys.
```

### 7.4 Updated `forget_memory` Tool Signature

```
forget_memory({ memoryId?: string, projectId?: string, scope?: 'personal' | 'shared' | 'all' })
```

---

## 8. New Artifacts

| Artifact | Path | Description |
|---|---|---|
| Promote tool | `src/tools/promote.ts` | `registerPromoteTool(server, sharedQdrant)` implementation |

---

## 9. Modified Artifacts

| File | Change |
|---|---|
| `src/lib/qdrant.ts` | Export `sharedQdrant` (QdrantClient \| null); add `ensureSharedCollection()` |
| `src/index.ts` | Init `sharedQdrant` at startup; call `ensureSharedCollection()`; pass to tool registrations; register `promote_memory` |
| `src/tools/remember.ts` | Add `scope: "personal"` to payload; auto-promote logic when tags match profile's `auto_promote_tags` |
| `src/tools/search.ts` | Accept `sharedQdrant`; parallel query; merge and sort results; add source labels |
| `src/tools/forget.ts` | Accept `sharedQdrant`; add `scope` input parameter; handle `"shared"` and `"all"` cases |
| `src/tools/list_projects.ts` | Accept `sharedQdrant`; scroll both instances in parallel; return deduplicated union of project IDs |
| `docker-compose.yml` | Add `qdrant-shared` service on port `6334` with `./qdrant_storage_shared` volume; add `QDRANT_SHARED_URL` to `mcp-server` env |
| `.gitignore` | Add `qdrant_storage_shared/` to ignored paths |

---

## 10. Deployment Model

| User Type | Configuration | Behaviour |
|---|---|---|
| Solo contributor | `QDRANT_URL` only | Personal memories, full Idea 1 functionality, no change |
| Team member | `QDRANT_URL` + `QDRANT_SHARED_URL` | Personal + shared search, can promote, auto-promotion via profile |
| New team member | `QDRANT_URL` + `QDRANT_SHARED_URL` (same shared URL) | Instantly inherits all promoted team knowledge on first search |

Teams deploy the shared Qdrant instance via the existing Docker Compose setup with one new env var — no new infrastructure tooling required.

---

## 11. Backward Compatibility

Hard contracts:

1. **No `QDRANT_SHARED_URL`** → `sharedQdrant` is `null` → every tool behaves identically to the Idea 1 implementation. No new fields, no new errors, no new logs.
2. **`forget_memory` `scope` parameter** → defaults to `"personal"`. Existing callers with no `scope` are unaffected.
3. **`search_memories` output format** → source labels (`[personal]` / `[shared]`) only appear when `sharedQdrant` is configured. Personal-only deployments see the current format.
4. **Existing personal memories** (stored before Idea 2) → do not have a `scope` field in their payload. Tools MUST handle the absence of `scope` gracefully (treat as `"personal"` if absent).

---

## 12. Test Requirements

### Unit Tests (no Qdrant required)

| Test | File | What to verify |
|---|---|---|
| Auto-promote tag intersection logic | `src/tools/remember.test.ts` or `tools.test.ts` | Tags `['architecture']` matches `auto_promote_tags: ['architecture']`; `['payments']` does not |
| Merge + sort logic for search results | `src/tools/search.test.ts` or `tools.test.ts` | Given personal results `[0.9, 0.6]` and shared `[0.85, 0.5]`, merged order is `[0.9, 0.85, 0.6, 0.5]` with correct labels |
| `forget_memory` scope routing | `tools.test.ts` | `scope: "personal"` calls personal delete only; `scope: "shared"` calls shared delete only; `scope: "all"` calls both |
| `promote_memory` returns error when sharedQdrant is null | `tools.test.ts` | Returns `isError: true` with correct message |
| `promote_memory` returns error when memoryId not found | `tools.test.ts` | `qdrant.retrieve` returns `[]`; returns `isError: true` |
| `promote_memory` copies with new UUID | `tools.test.ts` | Shared upsert called with a different UUID than the personal retrieve ID |
| `promote_memory` sets scope to "shared" in payload | `tools.test.ts` | Upserted payload has `scope: "shared"` |
| Personal copy untouched after promotion | `tools.test.ts` | `qdrant.delete` NOT called on personal after promote |
| Auto-promote: no-op when sharedQdrant is null | `tools.test.ts` | Returns success for personal write; no shared upsert attempted |
| Search: parallel query (both layers called) | `tools.test.ts` | Both `qdrant.search` and `sharedQdrant.search` called when shared is configured |
| Search: silent fallback when shared throws | `tools.test.ts` | `sharedQdrant.search` rejects; result contains only personal results; `isError` absent |

### Integration Tests (requires running Qdrant)

| Test | File | What to verify |
|---|---|---|
| `promote_memory` round-trip | `src/index.test.ts` | Store → promote → retrieve from shared: payload matches, new UUID assigned, personal copy intact |
| `search_memories` dual-layer merge | `src/index.test.ts` | Memories in both layers returned interleaved by score with correct labels |
| `forget_memory scope: "all"` | `src/index.test.ts` | Memory deleted from both layers |

---

## 13. Open Questions

| ID | Question | Owner | Priority |
|---|---|---|---|
| OQ-5 | Should `memory_health` (Idea 3) run automatically at session start for shared memories? The profile could include a `health_check_on_start: true` flag. Flagged here as a reminder to accommodate it in the profile schema if needed before Idea 3 starts. | Eng | Low (Idea 3 concern) |
| OQ-7 | ~~Should `list_projects` query both layers?~~ **RESOLVED** — Yes. A project is one logical entity split across two physical stores. `list_projects` MUST scroll both personal and shared instances in parallel, merge the project ID sets, and return the deduplicated union. Without this, `list_projects` returns an empty list for new team members even though the shared layer has project memories, and contradicts `search_memories` which does surface those results. `list_projects` is added to the Modified Artifacts table. | PM + Eng | Resolved |
| OQ-8 | ~~Should `docker-compose.yml` ship a second Qdrant service?~~ **RESOLVED** — Yes. A `qdrant-shared` service will be added on port `6334` with its own storage volume (`./qdrant_storage_shared`). `mcp-server` will have both `QDRANT_URL` and `QDRANT_SHARED_URL` set. Production deployments point `QDRANT_SHARED_URL` at their actual shared instance; docker-compose provides local dev parity. | Eng | Resolved |
