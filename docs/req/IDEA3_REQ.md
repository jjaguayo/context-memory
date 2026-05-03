# Requirements: Memory Provenance & Audit Trail

> **Status:** Draft — pending review
> **Authors:** Technical PM + Principal Engineer
> **Date:** 2026-04-20
> **Idea reference:** `PRODUCT_IDEAS.md` — Idea 3
> **Depends on:** Idea 1 (Team Memory Profiles), Idea 2 (Shared Memory Layer) — both must be implemented first
> **Implementation phase:** Trust (extends schema, adds `confirm_memory` and `memory_health` tools)

---

## 1. Overview

Today's shared memory layer surfaces results but gives teammates no way to judge them. A memory that says "We use PostgreSQL for payments" might have been stored two years ago by someone who left the company. Without provenance — who stored it, when, how recently it was validated — teams can't trust shared AI memory at scale, and it degrades into stale noise.

Idea 3 adds **provenance metadata** to every stored memory: author identity, session origin, an optional source file hint, and a `last_confirmed` timestamp used to compute confidence decay. A new `memory_health` tool surfaces memories that have aged past the team's defined threshold so they can be confirmed or discarded. A companion `confirm_memory` tool lets an agent reset the staleness clock on a memory that has been reviewed and is still valid.

Confidence is **computed lazily at query time** from `last_confirmed` — no background jobs, no scheduled tasks. The stored value is the timestamp; the computed value is the staleness indicator. Teams configure decay thresholds per category in `profile.yml`; the system default is 90 days.

---

## 2. Goals

- Record who stored each memory and in which session, without requiring any manual input from the agent.
- Compute memory confidence on-read from `last_confirmed`, with thresholds configurable per category in `profile.yml`.
- Surface stale and aging memories via `memory_health` so teams can review and prune before the shared layer becomes unreliable.
- Allow agents to confirm a memory is still valid via `confirm_memory`, resetting its staleness clock without re-storing the content.
- Support optional automatic health reporting at session start via a profile flag, so teams that want proactive staleness alerts get them without changing their workflow.
- Handle all existing memories (stored before Idea 3) gracefully using defaults — no migration required.

---

## 3. Non-Goals

The following are explicitly out of scope for this idea:

- **Automatic deletion of stale memories** — `memory_health` flags; it never deletes. Deletion remains a deliberate `forget_memory` call.
- **Conflict detection or resolution** — if two team members store contradicting shared memories, that is surfaced by reviewing health results and using `forget_memory`. No automated deduplication or conflict resolver is in scope.
- **Confidence-weighted search ranking** — `search_memories` continues to rank by cosine similarity only. Confidence is not a search signal in this phase.
- **Source file auto-detection** — `source_file` is agent-provided (optional input to `remember_info`). The server does not attempt to infer it from the environment.
- **Rich author identity** — `author` is a plain string from `$GIT_AUTHOR_NAME` or `$USER`. No OAuth, no user registry, no avatar.
- **Per-memory decay curve customisation** — decay threshold is per-category (via profile) or a global default. Individual memories cannot override their category's threshold.
- **Health dashboards or external reporting** — all output is via the MCP tool interface and stderr logs. No web UI, no metrics exporter.

---

## 4. User Stories

### Persona A — Team Lead (governs memory quality)

| ID | Story |
|---|---|
| TL-1 | As a team lead, I want to define retention thresholds per memory category in `profile.yml` so that architecture decisions age more slowly than quick gotchas. |
| TL-2 | As a team lead, I want to enable `health_check_on_start` in the profile so that every session begins with a staleness summary logged to stderr, keeping the team aware of aging shared memories without extra commands. |
| TL-3 | As a team lead, I want every memory to record who stored it so I know which teammate to ask when a shared memory looks wrong. |

### Persona B — Team Member (maintains memory quality day-to-day)

| ID | Story |
|---|---|
| TM-1 | As a team member, I want `memory_health` to show me which shared memories are stale or aging so I can confirm the ones that are still valid and delete the rest. |
| TM-2 | As a team member, I want to call `confirm_memory` on a memory I've reviewed so that its staleness clock resets without me having to re-store the full text. |
| TM-3 | As a team member, I want `remember_info` to automatically record my identity and the current session so I don't have to think about provenance. |
| TM-4 | As a team member, I want to optionally supply a `source_file` hint when storing a memory so that teammates know which part of the codebase the memory is anchored to. |

### Persona C — New Team Member (onboards via shared layer)

| ID | Story |
|---|---|
| NTM-1 | As a new team member, I want `memory_health` results to show the author of each stale memory so I know who to ask before confirming or deleting it. |
| NTM-2 | As a new team member, I want to trust that memories with recent `last_confirmed` timestamps have been reviewed, even if I didn't store them myself. |

---

## 5. Functional Requirements

### 5.1 Schema Extension

| ID | Requirement |
|---|---|
| F-01 | The Qdrant payload for every new memory written by `remember_info` MUST include four new fields: `author`, `session_id`, `last_confirmed`, and optionally `source_file`. |
| F-02 | `author` MUST be resolved at server startup from `$GIT_AUTHOR_NAME` if set, else `$USER`, else the string `"unknown"`. It MUST NOT be re-read on every tool call (resolved once at startup, passed into `registerRememberTool`). |
| F-03 | `session_id` MUST be a UUID (v4) generated once when the MCP server process starts. All memories stored in that server session share the same `session_id`. |
| F-04 | `last_confirmed` MUST be set to the current ISO 8601 UTC timestamp when a memory is first created by `remember_info`. |
| F-05 | `source_file` is an optional string. When provided by the agent via `remember_info`, it MUST be stored in the payload. When omitted, the field MUST be absent from the payload (not stored as `null`). |
| F-06 | `confidence` MUST NOT be stored in Qdrant. It is a derived value computed on-read from `last_confirmed` and the applicable threshold. Storing it would make it stale immediately. |

### 5.2 Confidence Computation

| ID | Requirement |
|---|---|
| F-07 | Confidence MUST be computed as: `Math.max(0, 1 - daysSince(last_confirmed) / threshold_days)`, where `daysSince` is the number of whole days between `last_confirmed` and the current UTC time. |
| F-08 | `threshold_days` for a given memory MUST be resolved in this order: (1) `retention.per_category[category]` from the active profile if the memory has a `category`; (2) `retention.default_days` from the active profile; (3) the system default of `90` days. |
| F-09 | A memory with confidence `0` (i.e., `daysSince >= threshold_days`) MUST be labelled `STALE` in all output. |
| F-10 | A memory with confidence `> 0` and `< 0.5` (i.e., more than half the threshold has elapsed) MUST be labelled `AGING` in all output. |
| F-11 | `memory_health` MUST surface both `STALE` and `AGING` memories. Memories with confidence `>= 0.5` are healthy and MUST NOT appear in health results. |
| F-12 | Existing memories that lack `last_confirmed` in their payload MUST be treated as if `last_confirmed` equals the memory's `timestamp` field. If `timestamp` is also absent, `last_confirmed` defaults to the current time (confidence = 1.0, effectively healthy). |

### 5.3 `remember_info` — Provenance Fields

| ID | Requirement |
|---|---|
| F-13 | `remember_info` MUST accept a new optional `source_file` parameter (string). All other existing parameters are unchanged. |
| F-14 | `remember_info` MUST write `author`, `session_id`, `last_confirmed`, and (if provided) `source_file` into the Qdrant payload alongside existing fields. |
| F-15 | `author` and `session_id` are server-resolved values (F-02, F-03) — they MUST NOT be exposed as input parameters on the `remember_info` tool. Agents cannot override them. |

### 5.4 `confirm_memory` — New Tool

| ID | Requirement |
|---|---|
| F-16 | A new MCP tool `confirm_memory` MUST be implemented in `src/tools/confirm.ts` and registered via `registerConfirmTool(server, sharedQdrant)`. |
| F-17 | `confirm_memory` MUST accept two parameters: `memoryId` (string, required) and `scope` (`"personal"` \| `"shared"`, optional, default `"personal"`). |
| F-18 | `confirm_memory` MUST retrieve the target memory, update only its `last_confirmed` field to the current ISO 8601 UTC timestamp, and re-upsert it with `wait: true`. All other payload fields MUST be preserved unchanged. |
| F-19 | If the memory is not found in the specified layer, `confirm_memory` MUST return `isError: true`: `"Memory <id> not found in <scope> layer."` |
| F-20 | If `scope` is `"shared"` and `sharedQdrant` is null, `confirm_memory` MUST return `isError: true`: `"Shared layer is not configured. Set QDRANT_SHARED_URL to confirm shared memories."` |
| F-21 | On success, `confirm_memory` MUST return: `"✅ Memory <id> confirmed. Staleness clock reset."` |
| F-22 | `confirm_memory` MUST return `isError: true` if the Qdrant retrieve or upsert throws. |

### 5.5 `memory_health` — New Tool

| ID | Requirement |
|---|---|
| F-23 | A new MCP tool `memory_health` MUST be implemented in `src/tools/health.ts` and registered via `registerHealthTool(server, sharedQdrant, profile)`. |
| F-24 | `memory_health` MUST accept two parameters: `projectId` (string, required) and `scope` (`"personal"` \| `"shared"` \| `"all"`, optional, default `"personal"`). |
| F-25 | When `scope` is `"personal"` or `"all"`, `memory_health` MUST scroll all memories for the given `projectId` from the personal Qdrant instance. |
| F-26 | When `scope` is `"shared"` or `"all"`, `memory_health` MUST scroll all memories for the given `projectId` from the shared Qdrant instance. It MUST return `isError: true` if `sharedQdrant` is null. |
| F-27 | When `scope` is `"all"`, both layers MUST be queried in parallel (using `Promise.all`). If the shared layer is unreachable, the tool MUST still return personal results and note the shared layer failure in the response. |
| F-28 | For each retrieved memory, `memory_health` MUST compute confidence per F-07 through F-12 and include only memories where confidence `< 0.5` in the results (i.e., `STALE` or `AGING`). |
| F-29 | Results MUST be sorted ascending by confidence (most stale first). |
| F-30 | Each result line MUST include: staleness label, age in days, memory ID, scope label (when shared configured), author, and a text preview (first 80 characters). Format: |

```
[STALE - 127 days] abc-123 [personal] (author: jsmith) "We use PostgreSQL for the payments service..."
[AGING - 52 days]  def-456 [shared]   (author: mjones) "Auth service uses RS256 JWT tokens for all..."
```

| ID | Requirement |
|---|---|
| F-31 | If no memories are stale or aging, `memory_health` MUST return: `"✅ All memories for project \"<id>\" are healthy."` |
| F-32 | The scope label (`[personal]` / `[shared]`) in health output MUST only appear when `sharedQdrant` is configured, consistent with `search_memories` behaviour. |

### 5.6 Server Startup — Provenance Initialisation

| ID | Requirement |
|---|---|
| F-33 | `src/index.ts` MUST generate a `session_id` (uuidv4) once at process start, before any tool registration. |
| F-34 | `author` MUST be resolved at startup: `process.env.GIT_AUTHOR_NAME ?? process.env.USER ?? "unknown"`. |
| F-35 | Both `session_id` and `author` MUST be passed into `registerRememberTool()` as parameters. |
| F-36 | `registerConfirmTool()` and `registerHealthTool()` MUST be called during startup with `sharedQdrant` (and `profile` for health). |

### 5.7 `profile.yml` Extension — Health Check on Start

| ID | Requirement |
|---|---|
| F-37 | The `MemoryProfileSchema` MUST be extended with a new optional boolean field `health_check_on_start` (default `false`). |
| F-38 | If `health_check_on_start` is `true` in the active profile, the server MUST call the equivalent of `memory_health` for the current project during startup and log the results to stderr. |
| F-39 | The startup health check MUST query the scope(s) configured: personal always; shared if `QDRANT_SHARED_URL` is set. |
| F-40 | If the startup health check finds no stale or aging memories, it MUST log: `[health] All memories for project "<id>" are healthy.` |
| F-41 | If the startup health check finds stale or aging memories, it MUST log a count summary and the full result list to stderr: `[health] 3 memories need review for project "<id>":` followed by each result line. |
| F-42 | A failure in the startup health check (e.g., Qdrant scroll error) MUST log a warning to stderr and MUST NOT crash the server. |

### 5.8 Graceful Degradation

| ID | Requirement |
|---|---|
| F-43 | Existing memories without `last_confirmed` MUST be handled per F-12 — no errors, no migration required. |
| F-44 | Existing memories without `author` MUST display as `author: unknown` in health output. |
| F-45 | All provenance features MUST be additive. No existing tool — `search_memories`, `forget_memory`, `promote_memory`, `list_projects`, `get_current_project_id` — changes in observable behaviour. |
| F-46 | Deployments with no active profile MUST use the 90-day system default for all confidence computations. |

---

## 6. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-01 | `memory_health` uses a Qdrant scroll (not search) to retrieve all memories for a project — it does not require a query vector. The scroll MUST paginate until all points are retrieved (respecting Qdrant's `next_page_offset`). |
| NF-02 | `confirm_memory` requires a `retrieve` then `upsert`. The retrieved vector MUST be used as-is — no re-embedding. Identical to `promote_memory`'s approach. |
| NF-03 | Confidence computation is pure arithmetic — no I/O. It MUST NOT add measurable latency to any tool call. |
| NF-04 | All new stderr log lines from health or provenance operations MUST be prefixed with `[health]` for easy filtering. |
| NF-05 | No new npm dependencies are required. `uuid` (already installed) covers `session_id` generation. |
| NF-06 | The startup health check (F-38) MUST complete before the server signals readiness on stdio. It is synchronous from the startup sequence's perspective. |

---

## 7. Schema Reference

### 7.1 Full Updated Qdrant Payload

```typescript
{
  text:           string;             // existing — stored content
  projectId:      string;             // existing — project scope (indexed)
  tags:           string[];           // existing — keywords
  timestamp:      string;             // existing — ISO 8601 creation time
  scope:          'personal' | 'shared';  // Idea 2 — physical layer
  category?:      string;             // Idea 1 — optional category
  author:         string;             // NEW — $GIT_AUTHOR_NAME | $USER | "unknown"
  session_id:     string;             // NEW — UUID of the server session that stored this
  last_confirmed: string;             // NEW — ISO 8601; set at creation, updated by confirm_memory
  source_file?:   string;             // NEW — optional; agent-provided file path hint
}
```

`confidence` is **not stored** — computed on-read: `Math.max(0, 1 - daysSince(last_confirmed) / threshold_days)`.

### 7.2 `confirm_memory` Tool Signature

```
confirm_memory({ memoryId: string, scope?: 'personal' | 'shared' })
→ "✅ Memory abc-123 confirmed. Staleness clock reset."
```

### 7.3 `memory_health` Tool Signature

```
memory_health({ projectId: string, scope?: 'personal' | 'shared' | 'all' })
→ [STALE - 127 days] abc-123 [personal] (author: jsmith) "We use PostgreSQL for payments..."
→ [AGING - 52 days]  def-456 [shared]   (author: mjones) "Auth uses RS256 JWT tokens..."
```

### 7.4 Updated `remember_info` Tool Signature

No new required parameters. One new optional parameter:

```
remember_info({
  text:        string,
  projectId:   string,
  tags?:       string[],
  category?:   string,       // Idea 1
  source_file?: string,      // NEW — optional file path hint
})
```

`author`, `session_id`, and `last_confirmed` are server-injected — not exposed as input parameters.

### 7.5 `profile.yml` Extension

```yaml
# New field in .context-memory/profile.yml
health_check_on_start: true   # optional, default false
                               # When true: server runs memory_health at startup and logs to stderr
```

---

## 8. New Artifacts

| Artifact | Path | Description |
|---|---|---|
| Confirm tool | `src/tools/confirm.ts` | `registerConfirmTool(server, sharedQdrant)` |
| Health tool | `src/tools/health.ts` | `registerHealthTool(server, sharedQdrant, profile)` |

---

## 9. Modified Artifacts

| File | Change |
|---|---|
| `src/lib/profile.ts` | Add `health_check_on_start?: boolean` to `MemoryProfileSchema` |
| `src/tools/remember.ts` | Accept `author: string` and `session_id: string` as parameters; add `source_file` to input schema; write all four provenance fields to Qdrant payload |
| `src/index.ts` | Generate `session_id` (uuidv4) and resolve `author` at startup; pass both into `registerRememberTool`; register `confirm_memory` and `memory_health`; run startup health check if `health_check_on_start` is set |
| `README.md` | Document provenance fields, `confirm_memory`, `memory_health`, `health_check_on_start`, updated `remember_info` signature |

---

## 10. Backward Compatibility

Hard contracts:

1. **Existing memories without provenance fields** — treated with graceful defaults (F-12, F-43, F-44). No errors, no migration, no change in `search_memories` or `forget_memory` behaviour.
2. **`remember_info` signature** — `source_file` is new and optional. Callers that omit it are unaffected.
3. **`profile.yml` schema** — `health_check_on_start` is optional with a default of `false`. Existing profiles without it behave identically to today.
4. **Solo deployments** — `author` defaults to `$USER` or `"unknown"`. `session_id` is a local UUID. `memory_health` operates on personal layer only. Zero infra change.
5. **No new required environment variables** — `$GIT_AUTHOR_NAME` and `$USER` are read but never required. The fallback `"unknown"` ensures the server always starts cleanly.

---

## 11. Test Requirements

### Unit Tests (no Qdrant required)

| Test | File | What to verify |
|---|---|---|
| Confidence = 1.0 for a brand-new memory | `tools.test.ts` | `daysSince = 0` → confidence = 1.0 |
| Confidence = 0.5 at halfway to threshold | `tools.test.ts` | `daysSince = 45` with 90-day threshold → confidence = 0.5 |
| Confidence = 0 at or beyond threshold | `tools.test.ts` | `daysSince = 90` → confidence = 0, labelled STALE |
| AGING label between 0 and 0.5 confidence | `tools.test.ts` | `daysSince = 60` → confidence = 0.33, labelled AGING |
| Per-category threshold overrides default | `tools.test.ts` | Category "Architecture Decisions" with 365-day threshold: `daysSince = 100` → confidence > 0.5, healthy |
| `memory_health` excludes healthy memories | `tools.test.ts` | Memories with confidence >= 0.5 absent from results |
| `memory_health` sorts by confidence ascending | `tools.test.ts` | STALE memory appears before AGING memory |
| `memory_health` returns "all healthy" message | `tools.test.ts` | No stale/aging memories → single success message |
| `confirm_memory` returns error when not found | `tools.test.ts` | `qdrant.retrieve` returns `[]` → `isError: true` |
| `confirm_memory` updates only `last_confirmed` | `tools.test.ts` | Upsert called with same payload except updated `last_confirmed`; vector unchanged |
| `confirm_memory` errors when scope=shared and no sharedQdrant | `tools.test.ts` | Returns `isError: true` with correct message |
| `remember_info` writes author, session_id, last_confirmed | `tools.test.ts` | Qdrant upsert payload includes all three provenance fields |
| `remember_info` writes source_file only when provided | `tools.test.ts` | When omitted: `source_file` absent from payload; when provided: present |
| Existing memory missing last_confirmed falls back to timestamp | `tools.test.ts` | Confidence computed from `timestamp` field; no error thrown |

### Integration Tests (requires running Qdrant)

| Test | File | What to verify |
|---|---|---|
| `remember_info` → `memory_health` round-trip | `src/index.test.ts` | Store memory, mock time 100+ days ahead, health returns it as STALE |
| `confirm_memory` resets staleness | `src/index.test.ts` | Store → age → confirm → health: memory disappears from stale list |
| `memory_health scope: "all"` merges layers | `src/index.test.ts` | Stale memory in each layer: both appear in health output with correct labels |

---

## 12. Open Questions

| ID | Question | Owner | Priority |
|---|---|---|---|
| OQ-9 | Should `search_memories` output optionally include confidence/age for stale memories as a warning? E.g., `[STALE - 127 days]` appended to the result line. This would surface staleness passively during normal search without requiring an explicit `memory_health` call. Deferred — does not block implementation. | PM + Eng | Low |
| OQ-10 | Should `confirm_memory` support `scope: "all"` to confirm the same memory ID in both layers simultaneously? Currently it targets a single layer. Deferred — single-layer confirm covers the primary use case. | Eng | Low |
