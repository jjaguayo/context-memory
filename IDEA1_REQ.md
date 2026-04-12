# Requirements: Team Memory Profiles ("Memory Standards")

> **Status:** Draft — pending review  
> **Authors:** Technical PM + Principal Engineer  
> **Date:** 2026-04-12  
> **Idea reference:** `PRODUCT_IDEAS.md` — Idea 1  
> **Implementation phase:** Foundation (no infra changes required)

---

## 1. Overview

Today, every `remember_info` call is free-form: any text, any tags, no enforced structure. This works fine for a single developer, but on a team of 6–25, the result is an inconsistent memory corpus — one engineer tags decisions as `architecture`, another uses `arch`, a third tags nothing at all. Searches degrade, shared context is unreliable, and the tool loses credibility.

A **Memory Profile** is a versioned, committable config file (`.context-memory/profile.yml`) that lets a team define their memory standard once: required tags, allowed categories, and retention rules. The MCP server reads the profile at startup and enforces it in `remember_info`. Projects without a profile file continue to work exactly as they do today — **zero breaking changes**.

---

## 2. Goals

- Allow a team to define and version a shared memory standard via a single config file.
- Enforce required tags and memory categories in `remember_info` when a profile is active.
- Make adoption purely opt-in: creating the file enables the feature; deleting it disables it with no side-effects.
- Lay the foundation for retention policy enforcement (decay) needed in Idea 3, without implementing it yet.
- Keep the implementation self-contained in a new `src/lib/profile.ts` module; changes to existing files should be minimal and additive.

---

## 3. Non-Goals

The following are explicitly out of scope for this idea:

- **Retention enforcement at runtime** — `retention_days` values are stored in the profile schema and passed through, but no memory is automatically deleted or marked stale in this phase. That is Idea 3.
- **Shared / remote profile hosting** — profiles are file-based only. No central registry, no git submodule sync. That may be addressed in a future phase.
- **UI or tooling to create profiles** — profiles are hand-authored YAML files. No generator CLI is planned here.
- **Profile inheritance or extension** — no `extends:` or multi-profile merging. One profile per project.
- **Retroactive tagging** — existing memories stored before a profile is activated are not re-validated or back-filled.
- **`search_memories` filtering by category** — category is stored in the payload for future use; `search_memories` is not changed in this phase.

---

## 4. User Stories

### Persona A — Team Lead (defines the standard)

| ID | Story |
|---|---|
| TL-1 | As a team lead, I want to define a list of required tags (e.g. `service`, `type`) so that every memory my team stores is consistently categorized. |
| TL-2 | As a team lead, I want to define allowed memory categories (e.g. "Architecture Decisions", "Known Gotchas") so agents store memories in a structured taxonomy. |
| TL-3 | As a team lead, I want to commit the profile to the repo so that every team member automatically gets the standard when they clone the project. |
| TL-4 | As a team lead, I want the profile to have a version field so I can evolve the standard and know which version each project is using. |
| TL-5 | As a team lead, I want to set retention hints per category so that when Idea 3 lands, the decay policy is already defined and needs no re-authoring. |

### Persona B — Team Member (uses the standard)

| ID | Story |
|---|---|
| TM-1 | As a team member, I want `remember_info` to tell me clearly if I'm missing a required tag, so I can fix it immediately rather than storing garbage. |
| TM-2 | As a team member, I want `remember_info` to accept a `category` field so I can file memories into the team taxonomy. |
| TM-3 | As a team member, I want my local setup to continue working without a profile so I can use the tool on personal projects without any config. |
| TM-4 | As a team member, I want validation errors to be actionable — listing exactly which required tags are missing — not just a generic failure. |

---

## 5. Functional Requirements

### 5.1 Profile File

| ID | Requirement |
|---|---|
| F-01 | The profile file MUST be located at `.context-memory/profile.yml` relative to `PROJECT_ROOT` (the same env var used by `get_current_project_id`). |
| F-02 | The profile file MUST be valid YAML. If the file exists but is not parseable YAML, the server MUST log a warning to stderr and fall back to no-profile behavior. |
| F-03 | The profile file MUST include a `version` field (integer). The current supported version is `1`. Unrecognized versions MUST log a warning and fall back to no-profile behavior. |
| F-04 | All profile fields except `version` and `name` are optional. A minimal valid profile contains only `version: 1`. |

### 5.2 `loadProfile()` Utility

| ID | Requirement |
|---|---|
| F-05 | A `loadProfile(projectRoot: string): Promise<MemoryProfile \| null>` function MUST be implemented in `src/lib/profile.ts`. |
| F-06 | `loadProfile()` MUST return `null` if the file does not exist (not an error). |
| F-07 | `loadProfile()` MUST return `null` and log a warning if the file exists but fails to parse or fails schema validation. |
| F-08 | `loadProfile()` MUST return a fully-typed `MemoryProfile` object when the file is valid. |
| F-09 | `loadProfile()` MUST resolve the profile path as `path.join(projectRoot, '.context-memory', 'profile.yml')`. |

### 5.3 Server Startup

| ID | Requirement |
|---|---|
| F-10 | `src/index.ts` MUST call `loadProfile(projectRoot)` during startup, after `ensureCollection()` and before registering tools. |
| F-11 | The loaded profile (or `null`) MUST be passed into `registerRememberTool()` as a parameter so the tool handler can enforce it. |
| F-12 | If a profile is loaded successfully, the server MUST log to stderr: `[profile] Loaded profile "<name>" v<version>`. |
| F-13 | If no profile is found, the server MUST NOT log any message about profiles (silent no-op). |
| F-14 | A profile load failure (parse error, invalid version) MUST log a warning but MUST NOT crash the server. |

### 5.4 `remember_info` Enforcement

| ID | Requirement |
|---|---|
| F-15 | `remember_info` MUST accept a new optional `category` field (string) alongside the existing `text`, `projectId`, and `tags` fields. |
| F-16 | When no profile is active, `remember_info` MUST behave identically to its current behavior. The `category` field, if provided, MUST be stored in the Qdrant payload but not validated. |
| F-17 | When a profile is active and defines `required_tags`, `remember_info` MUST check that every tag in `required_tags` is present in the provided `tags` array. |
| F-18 | If one or more required tags are missing, `remember_info` MUST return an error (with `isError: true`) listing the missing tags: `"Missing required tags: [service, type]. Profile: acme-eng-standard v1"`. |
| F-19 | When a profile is active and defines `memory_categories`, `remember_info` MUST check that the provided `category` value matches one of the allowed categories. |
| F-20 | If `category` is not in `memory_categories`, `remember_info` MUST return an error listing the allowed categories: `"Invalid category 'Misc'. Allowed categories: [Architecture Decisions, API Contracts, Known Gotchas, Coding Preferences]. Profile: acme-eng-standard v1"`. |
| F-21 | If `category` is not provided and `memory_categories` is defined in the profile, `remember_info` MUST NOT error — `category` remains optional even when the profile defines allowed values. |
| F-22 | The `category` field MUST be stored in the Qdrant payload when provided, whether or not a profile is active. |
| F-23 | Tags in `required_tags` checks MUST be case-sensitive (i.e. `"Service"` does not satisfy a requirement for `"service"`). |

### 5.5 Graceful Fallback

| ID | Requirement |
|---|---|
| F-24 | If `PROJECT_ROOT` is not set, `loadProfile()` MUST use `process.cwd()` as the root, consistent with `get_current_project_id` behavior. |
| F-25 | Deleting `.context-memory/profile.yml` and restarting the server MUST restore default (no-profile) behavior with no other changes required. |

---

## 6. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-01 | `loadProfile()` MUST complete in under 50ms on typical hardware. File I/O is synchronous-safe at startup; async `fs.readFile` is preferred. |
| NF-02 | Validation error messages from `remember_info` MUST be human-readable and actionable — they will appear directly in the agent's response to the user. |
| NF-03 | The `MemoryProfile` type MUST be defined using Zod so that the same schema can validate YAML payloads at runtime and generate TypeScript types via `z.infer<>`. |
| NF-04 | The profile schema MUST include all fields anticipated by Ideas 2 and 3 (e.g. `scope_policy`, `retention`) as optional fields — even if not enforced yet — to avoid breaking changes in future versions. |
| NF-05 | No new npm dependencies beyond `js-yaml` (for YAML parsing) and `zod` (already expected as a project dependency). |

---

## 7. Schema Reference

### 7.1 `profile.yml` — Full Example

```yaml
# .context-memory/profile.yml
version: 1                          # required — schema version (integer)
name: "acme-eng-standard"           # required — human-readable profile name

# Tags that MUST be present on every remember_info call.
# Violations return isError: true with a list of missing tags.
required_tags:
  - service     # which service this memory relates to
  - type        # architecture | decision | bug-fix | gotcha | preference

# Allowed values for the `category` field on remember_info.
# If provided, the value must match one of these exactly (case-sensitive).
# If category is not provided at all, no error is raised.
memory_categories:
  - Architecture Decisions
  - API Contracts
  - Known Gotchas
  - Coding Preferences

# Retention hints per category (days). Not enforced until Idea 3.
# Stored in the profile and passed through for future use.
retention:
  default_days: 90
  per_category:
    Architecture Decisions: 365
    API Contracts: 180
    Known Gotchas: 90
    Coding Preferences: 90

# Tags that will be auto-promoted to the shared layer (Idea 2).
# Stored but not acted on until Idea 2 is implemented.
auto_promote_tags:
  - architecture
  - api-contract
```

### 7.2 `MemoryProfile` TypeScript Type (Zod-derived)

```typescript
// src/lib/profile.ts

import { z } from 'zod';

const RetentionSchema = z.object({
  default_days: z.number().int().positive().optional(),
  per_category: z.record(z.string(), z.number().int().positive()).optional(),
});

export const MemoryProfileSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  required_tags: z.array(z.string()).optional().default([]),
  memory_categories: z.array(z.string()).optional().default([]),
  retention: RetentionSchema.optional(),
  auto_promote_tags: z.array(z.string()).optional().default([]),
});

export type MemoryProfile = z.infer<typeof MemoryProfileSchema>;
```

### 7.3 Updated Qdrant Payload Schema

```typescript
// Extended payload stored per memory point
{
  text: string;           // existing — the stored content
  projectId: string;      // existing — project scope identifier
  tags: string[];         // existing — keywords for categorization
  timestamp: string;      // existing — ISO 8601 creation time
  category?: string;      // NEW — optional memory category (validated against profile)
}
```

---

## 8. New Artifacts

| Artifact | Path | Description |
|---|---|---|
| Profile loader | `src/lib/profile.ts` | `loadProfile()` function, `MemoryProfileSchema`, `MemoryProfile` type |
| Profile config | `.context-memory/profile.yml` | Example profile file (not committed — teams create their own) |

---

## 9. Modified Artifacts

| File | Change |
|---|---|
| `src/index.ts` | Import and call `loadProfile(projectRoot)` at startup; pass result into `registerRememberTool()` |
| `src/tools/remember.ts` | Accept `MemoryProfile \| null` as parameter to `registerRememberTool()`; add `category` to input schema; add profile validation logic before storing; store `category` in Qdrant payload |

No other files require changes.

---

## 10. Backward Compatibility

This is a hard contract:

1. **No profile file present** → `loadProfile()` returns `null` → `remember_info` behaves identically to today, including the Qdrant payload schema (the new `category` field is simply absent when not provided).
2. **Profile file present but unparseable** → server logs a warning, loads `null`, same as above.
3. **Existing memories** → no migration. Memories stored before a profile was activated have no `category` and may lack `required_tags`. They are not re-validated. The profile only governs new `remember_info` calls.
4. **MCP tool signature** → `category` is an optional new field. Existing callers that do not pass `category` continue to work without change.

---

## 11. Test Requirements

### Unit Tests (no Qdrant required)

| Test | File | What to verify |
|---|---|---|
| `loadProfile()` returns `null` when file absent | `src/lib/profile.test.ts` | No error thrown; returns `null` |
| `loadProfile()` returns `null` on invalid YAML | `src/lib/profile.test.ts` | Warning logged; returns `null` |
| `loadProfile()` returns `null` on unknown version | `src/lib/profile.test.ts` | Warning logged; returns `null` |
| `loadProfile()` parses minimal valid profile | `src/lib/profile.test.ts` | Returns object with `version: 1`, defaults applied |
| `loadProfile()` parses full profile with all fields | `src/lib/profile.test.ts` | All fields correctly typed |
| `MemoryProfileSchema` rejects missing `version` | `src/lib/profile.test.ts` | Zod parse throws |
| `MemoryProfileSchema` accepts profile with only `version` + `name` | `src/lib/profile.test.ts` | Parse succeeds with defaults |

### Integration Tests (Qdrant required)

| Test | File | What to verify |
|---|---|---|
| `remember_info` stores with `category` field when no profile | `src/index.test.ts` | Payload includes `category`; no error |
| `remember_info` succeeds when all required tags present | `src/index.test.ts` | Memory stored; no error |
| `remember_info` returns `isError: true` with message when required tag missing | `src/index.test.ts` | Error message names the missing tags and profile name |
| `remember_info` returns `isError: true` when invalid category provided | `src/index.test.ts` | Error message lists allowed categories |
| `remember_info` succeeds when `category` omitted and profile defines `memory_categories` | `src/index.test.ts` | Category is optional even with profile active |

---

## 12. Open Questions

The following questions must be resolved before or during implementation. They are recorded here to surface in the review.

| ID | Question | Owner | Priority |
|---|---|---|---|
| OQ-1 | Should `profile.yml` live in `.context-memory/` (project-local, gitignored by default) or in a visible location like `context-memory.yml` at the repo root? `.context-memory/` keeps the repo cleaner but requires ensuring it is not gitignored. | PM + Eng | **RESOLVED** — `.context-memory/profile.yml`. Not gitignored. A scoped `.context-memory/.gitignore` (pattern: `*` / `!profile.yml`) protects against accidental commits of future runtime artifacts while keeping the profile tracked. |
| OQ-2 | Should `required_tags` be enforced strictly (error) or softly (warning stored in payload)? | PM | **RESOLVED** — Strictly enforced. `remember_info` returns `isError: true` with an actionable message listing missing tags. |
| OQ-3 | Should `memory_categories` be enforced strictly (error if invalid) or softly (store with a warning flag)? | PM | **RESOLVED** — Strictly enforced. `remember_info` returns `isError: true` with the list of allowed categories. |
| OQ-4 | What is the right UX for `promote_memory` (Idea 2) — explicit tool call, or a flag on `remember_info`? The profile's `auto_promote_tags` field implies automatic behavior, which may conflict with the explicit tool model. This does not block Idea 1 but should be resolved before Idea 2 starts. | PM + Eng | Open — Idea 2 concern |
| OQ-5 | Should `memory_health` (Idea 3) run automatically at session start for shared memories? The profile could include a `health_check_on_start: true` flag. This does not block Idea 1 but `profile.yml` schema should accommodate it. | Eng | Open — Idea 3 concern |
| OQ-6 | Is `js-yaml` the right YAML parser? It is the most widely used Node.js YAML library and has no native dependencies. Confirm there are no license or size concerns given the Docker image. | Eng | **RESOLVED** — `js-yaml 4.1.1` installed. MIT license. No native dependencies. |
