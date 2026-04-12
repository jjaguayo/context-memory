# context-memory

An MCP (Model Context Protocol) server that gives AI agents persistent semantic memory across sessions. It stores, searches, and manages information using a local Qdrant vector database and WASM-based text embeddings — no external APIs required.

Teams can optionally deploy a shared Qdrant instance so every developer's AI agent draws from the same pool of architectural decisions, API contracts, and known gotchas.

## How It Works

When an AI agent calls `remember_info`, the text is converted into a 384-dimensional vector using the `all-MiniLM-L6-v2` model (runs locally via WASM) and stored in Qdrant. When the agent calls `search_memories`, the query is embedded the same way and a cosine similarity search finds the most relevant stored memories — even if the phrasing differs.

## Requirements

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10.11.0
- [Docker](https://www.docker.com/) + Docker Compose (for the recommended setup)

## Build

```bash
# Install dependencies (also installs the pre-push git hook)
pnpm install

# Compile TypeScript → dist/
pnpm run build
```

## Launch

### Recommended: Docker Compose

Starts the MCP server alongside both a personal and a shared Qdrant instance:

```bash
docker-compose up
```

| Service | Port | Purpose |
|---|---|---|
| `qdrant` | 6333 | Personal vector database. Dashboard: http://localhost:6333/dashboard |
| `qdrant-shared` | 6334 | Shared vector database (team layer). Dashboard: http://localhost:6334/dashboard |
| `mcp-server` | — | MCP server connected to both Qdrant instances |

Data is persisted in `./qdrant_storage/` (personal) and `./qdrant_storage_shared/` (shared).

### Local (without Docker)

Start Qdrant separately, then run the server with the relevant environment variables:

```bash
# Personal only
QDRANT_URL=http://localhost:6333 pnpm run start

# Personal + shared layer
QDRANT_URL=http://localhost:6333 QDRANT_SHARED_URL=http://localhost:6334 pnpm run start
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Personal Qdrant instance URL |
| `QDRANT_SHARED_URL` | _(unset)_ | Shared Qdrant instance URL. When set, enables the team memory layer. |
| `PROJECT_ROOT` | Current working directory | Used to derive the default project ID and locate the team memory profile |

## Connecting to Claude Code

Add the server to your Claude Code MCP configuration via `claude mcp add`:

```bash
claude mcp add-json docker-memory '{
  "command": "docker",
  "args": ["exec", "-i", "-e", "PROJECT_ROOT=$(pwd)", "context-memory-mcp-server", "node", "dist/index.js"]
}'
```

Also consider adding instructions for how to use the tools in your agent's system prompt, referencing the tool names and expected inputs/outputs.
The `CLAUDE.md` file in this repo provides an example of how to do this.

## MCP Tools

Once connected, the AI agent has access to six tools:

### `get_current_project_id`
Returns the current project identifier derived from `$PROJECT_ROOT` or the working directory name. Call this at the start of a session to scope memories to the right project.

```
get_current_project_id()
→ "my-project"
```

### `remember_info`
Stores a piece of text with optional tags and category, scoped to a project. When a [team memory profile](#team-memory-profiles) is active, required tags and allowed categories are enforced.

If the stored memory's tags match `auto_promote_tags` in the active profile and a shared layer is configured, the memory is automatically promoted to the shared layer.

```
remember_info({
  text: "The payment service uses idempotency keys to prevent duplicate charges.",
  projectId: "my-project",
  tags: ["payments", "architecture"],
  category: "Architecture Decisions"   // optional; validated against profile if one is active
})
```

### `search_memories`
Performs a semantic similarity search across stored memories. When a shared layer is configured, results from both layers are merged and ranked by relevance. Each result is labelled with its source.

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

### `promote_memory`
Copies a personal memory to the shared layer so teammates can find it. The personal copy is kept.

```
promote_memory({ memoryId: "abc-123" })
→ "✅ Memory abc-123 promoted to shared layer (shared ID: xyz-789) for project \"my-project\"."
```

Requires `QDRANT_SHARED_URL` to be configured.

### `forget_memory`
Deletes a single memory by ID, or all memories for a project. Use the optional `scope` parameter to target a specific layer.

```
# Delete from personal layer (default)
forget_memory({ memoryId: "abc-123" })
forget_memory({ memoryId: "abc-123", scope: "personal" })

# Delete from shared layer
forget_memory({ memoryId: "xyz-789", scope: "shared" })

# Delete from both layers
forget_memory({ projectId: "my-project", scope: "all" })
```

### `list_projects`
Lists all projects that have at least one stored memory. Queries both personal and shared layers and returns the deduplicated union.

```
list_projects()
→ ["my-project", "other-project"]
```

---

## Team Memory Profiles

Memory profiles let engineering teams define a shared standard for what goes into memory: required tags, allowed categories, and retention hints. The standard is version-controlled alongside the code and automatically applied to every `remember_info` call.

### Setup

Create `.context-memory/profile.yml` in your project root:

```yaml
version: 1
name: "acme-eng-standard"

# Every remember_info call must include these tags (case-sensitive).
required_tags:
  - service   # which service this memory relates to
  - type      # architecture | decision | bug-fix | gotcha | preference

# Allowed values for the optional `category` field.
# If category is provided, it must match one of these exactly.
memory_categories:
  - Architecture Decisions
  - API Contracts
  - Known Gotchas
  - Coding Preferences

# Memories tagged with any of these are automatically promoted to shared
# when a shared layer is configured.
auto_promote_tags:
  - architecture
  - api-contract

# Retention hints (not enforced yet — reserved for a future release).
retention:
  default_days: 90
  per_category:
    Architecture Decisions: 365
    API Contracts: 180
```

The file should be committed to your repo so all team members inherit the standard automatically. The `.context-memory/` directory uses a scoped `.gitignore` that tracks only `profile.yml` — any runtime artifacts added in the future will not be committed.

### How Enforcement Works

When the server starts, it looks for `.context-memory/profile.yml` relative to `PROJECT_ROOT`. If the file is found:

- **Required tags** — `remember_info` returns an error if any required tag is missing:
  ```
  Missing required tags: [type]. Profile: acme-eng-standard v1
  ```

- **Category validation** — if a `category` is provided and does not match `memory_categories`, `remember_info` returns an error:
  ```
  Invalid category 'Misc'. Allowed categories: [Architecture Decisions, API Contracts, Known Gotchas, Coding Preferences]. Profile: acme-eng-standard v1
  ```

- **Auto-promotion** — if a memory's tags intersect `auto_promote_tags` and `QDRANT_SHARED_URL` is configured, the memory is automatically promoted:
  ```
  ✅ Remembered for project "my-project" and auto-promoted to shared (tag: architecture): ...
  ```

- **Category is always optional** — omitting `category` is valid even when `memory_categories` is defined.

### Backward Compatibility

Projects without a `.context-memory/profile.yml` file behave exactly as before. Projects without `QDRANT_SHARED_URL` set see no change from the shared layer features.

---

## Team Setup

### Solo Developer
No additional configuration needed. Run as normal — everything uses the personal Qdrant instance.

### Connecting a Team to a Shared Layer

1. **Deploy a shared Qdrant instance** on your team's infrastructure (or use the local `docker-compose` setup for testing):
   ```bash
   docker-compose up qdrant-shared
   ```

2. **Each team member sets `QDRANT_SHARED_URL`** pointing to the shared instance in their MCP server configuration.

3. **Team members can now:**
   - Search shared memories automatically via `search_memories`
   - Promote personal memories to shared via `promote_memory`
   - Define `auto_promote_tags` in `profile.yml` for automatic promotion

4. **New team members** — configure `QDRANT_SHARED_URL` and immediately inherit the team's shared knowledge base.

---

## Development

```bash
# Watch mode (recompiles on file changes)
pnpm run dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

The pre-push git hook (installed by `pnpm install` via the `prepare` script) runs the full test suite before any push to `main`.

## Vector Database Schema

```
Collection : memories
Vector size: 384 dimensions
Distance   : Cosine

Payload fields:
  text      : string        — the stored content
  projectId : string        — project scope (indexed)
  tags      : string[]      — keywords for categorization
  timestamp : ISO 8601      — when the memory was created
  scope     : "personal" | "shared"  — which layer this memory lives in
  category  : string?       — optional memory category (validated against profile if active)
```

## Tech Stack

| Component | Technology |
|---|---|
| Protocol | Model Context Protocol (MCP) SDK |
| Embeddings | `Xenova/all-MiniLM-L6-v2` via WASM (no GPU needed) |
| Vector DB | Qdrant |
| Language | TypeScript (ESNext, strict mode) |
| Runtime | Node.js 20 |
| Package manager | pnpm |
| Tests | Vitest |
