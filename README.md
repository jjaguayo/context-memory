# context-memory

**Team-grade long-term memory for AI agents — personal and shared.**

Your AI coding agent forgets everything between sessions. context-memory fixes that. It gives agents a persistent, searchable memory layer backed by a local vector database — and when your team is ready, a shared layer so every developer's agent draws from the same pool of architectural decisions, API contracts, and hard-won gotchas.

Works as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server with Claude Code, Cursor, and any MCP-compatible agent. No external APIs. No cloud dependencies. Fully self-hosted.

---

## Quick Start

**Requirements:** Node.js 20+, pnpm 10.11.0, Docker + Docker Compose

### 1. Clone and build

```bash
git clone https://github.com/joseaguayo/context-memory.git
cd context-memory
pnpm install
pnpm run build
```

### 2. Start the server

```bash
docker-compose up
```

| Service | Port | Purpose |
|---|---|---|
| `qdrant` | 6333 | Personal vector database. Dashboard: http://localhost:6333/dashboard |
| `qdrant-shared` | 6334 | Shared team database (optional). Dashboard: http://localhost:6334/dashboard |
| `mcp-server` | — | MCP server, connected to both |

### 3. Connect to Claude Code

```bash
claude mcp add-json context-memory '{
  "command": "docker",
  "args": ["exec", "-i", "-e", "PROJECT_ROOT=$(pwd)", "context-memory-mcp-server", "node", "dist/index.js"]
}'
```

Your agent can now store and search memories across sessions. See [Configuration](#configuration) for environment variables and [Local setup (without Docker)](#local-without-docker) for running without containers.

---

## How It Works

When an agent calls `remember_info`, the text is converted into a 384-dimensional vector using `all-MiniLM-L6-v2` (runs locally via WASM — no GPU required) and stored in Qdrant. When the agent calls `search_memories`, the query is embedded the same way and a cosine similarity search returns the most relevant memories, even when the phrasing differs.

Every memory stores provenance metadata alongside the content: who stored it (`author`), which session it came from (`session_id`), and when it was last confirmed as still valid (`last_confirmed`). The `memory_health` tool uses this to surface memories that have gone stale so teams can review them before they become noise.

The server supports two layers: a **personal layer** (local Qdrant, always on) and an optional **shared layer** (team-deployed Qdrant, configured via `QDRANT_SHARED_URL`). Searches query both layers and return results interleaved by relevance.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Personal Qdrant instance |
| `QDRANT_SHARED_URL` | _(unset)_ | Shared Qdrant instance. When set, enables the team memory layer. |
| `PROJECT_ROOT` | Current working directory | Used to derive the project ID and locate `profile.yml` |
| `GIT_AUTHOR_NAME` | _(unset)_ | Written to memory provenance. Falls back to `$USER`, then `"unknown"`. |

### Local (without Docker)

Start Qdrant separately, then run:

```bash
# Personal only
QDRANT_URL=http://localhost:6333 pnpm run start

# Personal + shared layer
QDRANT_URL=http://localhost:6333 QDRANT_SHARED_URL=http://localhost:6334 pnpm run start
```

---

## MCP Tools

Eight tools are available once the server is connected. The most-used tools are `remember_info`, `search_memories`, and `memory_health`. The full list:

| Tool | What it does |
|---|---|
| `get_current_project_id` | Returns the active project ID (use this at session start) |
| `remember_info` | Stores a memory with tags, category, and optional file hint |
| `search_memories` | Semantic search across personal and shared memories |
| `promote_memory` | Copies a personal memory to the shared team layer |
| `confirm_memory` | Resets the staleness clock on a memory you've reviewed |
| `memory_health` | Lists memories that are stale or aging, sorted by severity |
| `forget_memory` | Deletes a memory or all memories for a project |
| `list_projects` | Lists all projects with stored memories |

---

### `get_current_project_id`

Call this at the start of every session to get the project ID for scoping memories correctly.

```
get_current_project_id()
→ "my-project"
```

---

### `remember_info`

Store anything worth keeping — architectural decisions, API quirks, debugging breakthroughs. The agent's identity and session are recorded automatically. Supply `source_file` when the memory is anchored to a specific file.

```
remember_info({
  text: "The payment service uses idempotency keys to prevent duplicate charges.",
  projectId: "my-project",
  tags: ["payments", "architecture"],
  category: "Architecture Decisions",   // optional; validated against profile if one is active
  source_file: "src/payments/service.ts" // optional; file this memory relates to
})
→ "✅ Successfully remembered for project \"my-project\": ..."
```

When a [team profile](#team-memory-profiles) is active, `remember_info` enforces required tags and validates categories before storing. If a memory's tags match `auto_promote_tags` in the profile and a shared layer is configured, the memory is promoted automatically.

---

### `search_memories`

Semantic search — finds relevant memories even when the phrasing differs from how they were stored. When a shared layer is configured, both layers are queried in parallel and results are interleaved by similarity score.

```
search_memories({
  query: "How does billing handle duplicate requests?",
  projectId: "my-project",
  limit: 5
})
→ [ID: abc-123] [personal] [Project: my-project] The payment service uses idempotency keys...
→ [ID: def-456] [shared]   [Project: my-project] Billing retries are capped at 3 attempts...
```

If the shared layer is unreachable, personal results are returned without error.

---

### `promote_memory`

Move a personal memory into the shared team layer so teammates can find it. The personal copy is kept.

```
promote_memory({ memoryId: "abc-123" })
→ "✅ Memory abc-123 promoted to shared layer (shared ID: xyz-789) for project \"my-project\"."
```

Requires `QDRANT_SHARED_URL` to be set.

---

### `confirm_memory`

When `memory_health` flags a memory as stale, use this to reset its staleness clock after reviewing it. Only `last_confirmed` is updated — the content stays the same.

```
confirm_memory({ memoryId: "abc-123" })                    // personal layer (default)
confirm_memory({ memoryId: "xyz-789", scope: "shared" })   // shared layer
→ "✅ Memory abc-123 confirmed. Staleness clock reset."
```

---

### `memory_health`

Call this to review which memories have gone stale (past the threshold) or are aging (past 50% of the threshold). Results are sorted with the most stale first. Use `confirm_memory` to validate or `forget_memory` to remove.

```
memory_health({ projectId: "my-project" })                 // personal layer (default)
memory_health({ projectId: "my-project", scope: "all" })   // both layers
→ [STALE - 127 days] abc-123 [personal] (author: jsmith) "We use PostgreSQL for the payments service..."
→ [AGING - 52 days]  def-456 [shared]   (author: mjones) "Auth service uses RS256 JWT tokens for all..."
```

Thresholds default to **90 days** and are configurable per category in `profile.yml`.

---

### `forget_memory`

Delete a single memory by ID or all memories for a project. Scope controls which layer is targeted.

```
forget_memory({ memoryId: "abc-123" })                            // personal (default)
forget_memory({ memoryId: "xyz-789", scope: "shared" })           // shared only
forget_memory({ projectId: "my-project", scope: "all" })          // both layers
```

---

### `list_projects`

Lists every project with at least one stored memory, across both personal and shared layers.

```
list_projects()
→ ["my-project", "other-project"]
```

---

## Team Memory Profiles

Memory profiles let your team define a shared standard for what goes into memory. One YAML file, committed to the repo — every agent on the team picks it up automatically.

### Setup

Create `.context-memory/profile.yml` in your project root:

```yaml
version: 1
name: "acme-eng-standard"

# Every remember_info call must include these tags (case-sensitive).
required_tags:
  - service   # which service this memory relates to
  - type      # architecture | decision | bug-fix | gotcha | preference

# Allowed values for the `category` field.
# A category is always optional — but if provided, it must match one of these.
memory_categories:
  - Architecture Decisions
  - API Contracts
  - Known Gotchas
  - Coding Preferences

# Tags that trigger automatic promotion to the shared layer.
auto_promote_tags:
  - architecture
  - api-contract

# Staleness thresholds for memory_health. Defaults to 90 days.
retention:
  default_days: 90
  per_category:
    Architecture Decisions: 365
    API Contracts: 180

# Run memory_health at startup and log the results to stderr.
health_check_on_start: true
```

The `.context-memory/` directory uses a scoped `.gitignore` — `profile.yml` is tracked; any future runtime artifacts are not.

### What the profile enforces

- **Required tags** — `remember_info` returns an actionable error listing exactly which tags are missing:
  ```
  Missing required tags: [type]. Profile: acme-eng-standard v1
  ```

- **Category validation** — if a `category` is provided that isn't in `memory_categories`:
  ```
  Invalid category 'Misc'. Allowed categories: [Architecture Decisions, API Contracts, ...]. Profile: acme-eng-standard v1
  ```

- **Auto-promotion** — memories tagged with `auto_promote_tags` are promoted to shared automatically (when `QDRANT_SHARED_URL` is configured):
  ```
  ✅ Remembered for project "my-project" and auto-promoted to shared (tag: architecture): ...
  ```

- **Startup health check** — when `health_check_on_start: true`, the server runs `memory_health` at startup and logs results to stderr so you see stale memories before the session begins.

**No profile? No change.** Projects without a `profile.yml` behave exactly as before.

---

## Team Setup

### Solo developer
No extra configuration. Run as-is — everything uses your personal Qdrant instance.

### Onboarding a team

1. **Deploy a shared Qdrant instance** on your team's infrastructure (or use the local `docker-compose` setup to test the setup first):
   ```bash
   docker-compose up qdrant-shared
   ```

2. **Each team member sets `QDRANT_SHARED_URL`** in their MCP server config, pointing at the shared instance.

3. **From that point, team members can:**
   - Find shared knowledge in every `search_memories` call
   - Promote personal memories to shared via `promote_memory`
   - Use `auto_promote_tags` in `profile.yml` to skip the manual promote step
   - Review and confirm shared memories via `memory_health` + `confirm_memory`

4. **New team member onboarding:** set `QDRANT_SHARED_URL` and immediately inherit everything the team has shared — no import, no sync, no manual setup.

| User type | Config | Behaviour |
|---|---|---|
| Solo developer | `QDRANT_URL` only | Personal memories, full feature set, no change |
| Team member | `QDRANT_URL` + `QDRANT_SHARED_URL` | Personal + shared search, promotion, health checks |
| New team member | Same `QDRANT_SHARED_URL` as teammates | Inherits all shared team knowledge immediately |

---

## Contributing

Contributions are welcome. context-memory is MIT-licensed and open source.

The best places to start:

- **Roadmap** — `PRODUCT_IDEAS.md` describes the next feature ideas and how they fit together. Each idea has a matching `IDEA_REQ.md` requirements document.
- **Tests** — run `pnpm test` to verify your changes. The test suite uses [Vitest](https://vitest.dev/) and does not require a running Qdrant instance for unit tests.
- **Pull requests** — open a PR against `main`. The pre-push hook runs the full test suite automatically before pushing.

If you find a bug or have a feature idea, open an issue.

---

## Development

```bash
# Install dependencies (also installs the pre-push git hook)
pnpm install

# Compile TypeScript → dist/
pnpm run build

# Watch mode — recompiles on file changes
pnpm run dev

# Run tests (no Qdrant required)
pnpm test

# Run tests in watch mode
pnpm test:watch
```

---

## Schema Reference

```
Collection : memories
Vector size: 384 dimensions
Distance   : Cosine

Payload fields:
  text           : string              — the stored content
  projectId      : string              — project scope (indexed)
  tags           : string[]            — keywords for categorization
  timestamp      : ISO 8601            — when the memory was created
  scope          : "personal"|"shared" — which layer this memory lives in
  category       : string?             — optional category (validated against profile if active)
  author         : string              — $GIT_AUTHOR_NAME or $USER at store time; "unknown" if unset
  session_id     : string              — UUID of the server session that stored this memory
  last_confirmed : ISO 8601            — set at creation; updated by confirm_memory
  source_file    : string?             — optional file path hint, agent-provided

Derived (not stored):
  confidence     : float [0,1]         — max(0, 1 - daysSince(last_confirmed) / threshold_days)
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Protocol | Model Context Protocol (MCP) SDK |
| Embeddings | `Xenova/all-MiniLM-L6-v2` via WASM (no GPU required) |
| Vector DB | Qdrant |
| Language | TypeScript (ESNext, strict mode) |
| Runtime | Node.js 20 |
| Package manager | pnpm |
| Tests | Vitest |

---

MIT License — Copyright (c) 2026 Jose John Aguayo
