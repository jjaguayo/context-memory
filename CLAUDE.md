# AI Long-Term Memory Protocol (MCP)

You are equipped with a persistent semantic memory layer. Use it to maintain context across sessions and prevent repetitive mistakes.

## 1. Context Initialization

* **First Step:** Always call `get_current_project_id` at the start of a session.
* **Cross-Repo:** Use `list_projects` if you suspect you've solved a similar problem in another codebase.

## 2. When to Remember (`remember_info`)

* **After a Bug Fix:** Save the root cause and the specific solution.
* **After an Architecture Decision:** Save the "Why" (trade-offs) and the "How."
* **User Preferences:** Save coding styles, library choices, or specific business logic I explain.
* **Project ID:** Use the value returned by `get_current_project_id`.
* **Fields:** `text` (required), `projectId` (required), `tags` (optional array), `category` (optional string).
* **Team Profiles:** If a `.context-memory/profile.yml` is active, `tags` may be required and `category` must match an allowed value. Validation errors are returned as `isError: true` with an actionable message listing what is missing or invalid.

## 3. When to Search (`search_memories`)

* **Starting a Task:** Search for existing context or "lessons learned" in this project.
* **Unfamiliar Code:** Search to see if past logic or decisions were documented.
* **Error Resolution:** Search for similar error strings to find previous fixes.

## 4. Maintenance (`forget_memory`)

* If a decision is reversed or a memory is found to be a hallucination/duplicate, use `forget_memory` with the specific ID found during a search.

---

## 5. Product Roadmap Context

This project is evolving from a personal Claude Code memory tool into a **team-grade persistent memory layer** for mid-size engineering teams (6–25). The three product ideas below are the current roadmap focus. Reference `PRODUCT_IDEAS.md` for full detail.

### Idea 1 — Team Memory Profiles ("Memory Standards")
A `.context-memory/profile.yml` config that defines tagging conventions, retention rules, and required memory categories for a team. Projects opt into a profile; existing projects without one retain current behavior. **No breaking changes.**

Key things to know when working on this:
- Profile schema lives in `src/` — add a `ProfileSchema` type and a `loadProfile()` utility
- The MCP server should call `loadProfile()` at startup and pass it into tool handlers
- `remember_info` should enforce required tags and categories defined in the profile
- Graceful fallback if no profile is found (current behavior)

### Idea 2 — Shared Memory Layer with Personal Override
Extend the memory model with a `scope` field (`personal` | `shared`). Personal memories go to local Qdrant; shared memories go to a team-deployed remote instance configured via `QDRANT_SHARED_URL`. A new `promote_memory` tool moves a personal memory to the shared layer.

Key things to know when working on this:
- Current `QDRANT_URL` becomes the personal layer; add `QDRANT_SHARED_URL` for the shared layer
- `search_memories` should query both layers and merge/rank results
- `promote_memory` tool signature: `{ memoryId: string }` → copies to shared, optionally deletes from personal
- If `QDRANT_SHARED_URL` is not set, shared-layer features degrade gracefully

### Idea 3 — Memory Provenance & Audit Trail
Extend the Qdrant payload schema with `author`, `source_file`, `session_id`, `confidence`, and `last_confirmed`. Add a `memory_health` tool that surfaces stale or low-confidence memories. Confidence decays over time per profile policy.

Key things to know when working on this:
- `author` should be auto-populated from `$GIT_AUTHOR_NAME` or `$USER` env vars
- Confidence decay should be configurable per memory category in `profile.yml`
- `memory_health` tool signature: `{ projectId: string, scope?: 'personal' | 'shared' }` → returns list of stale/low-confidence memories with IDs for review
- Consider calling `memory_health` automatically at session start for shared memories (configurable)

### Implementation Sequence
1. **Memory Profiles** (config only, no infra changes) — start here
2. **Shared Layer** (extends infra, adds `promote_memory` tool)
3. **Provenance** (extends schema, adds `memory_health` tool)
