# context-memory

An MCP (Model Context Protocol) server that gives AI agents persistent semantic memory across sessions. It stores, searches, and manages information using a local Qdrant vector database and WASM-based text embeddings — no external APIs required.

## How It Works

When an AI agent calls `remember_info`, the text is converted into a 384-dimensional vector using the `all-MiniLM-L6-v2` model (runs locally via WASM) and stored in Qdrant. When the agent calls `search_memories`, the query is embedded the same way and a cosine similarity search finds the most relevant stored memories — even if the phrasing differs.

## Requirements

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10.11.0
- [Docker](https://www.docker.com/) + Docker Compose (for the recommended setup)

## Build

```bash
# Install dependencies
pnpm install

# Compile TypeScript → dist/
pnpm run build
```

## Launch

### Recommended: Docker Compose

Starts both the Qdrant vector database and the MCP server together:

```bash
docker-compose up
```

Qdrant data is persisted in `./qdrant_storage/`. The Qdrant dashboard is available at `http://localhost:6333/dashboard`.

### Local (without Docker)

You must have a Qdrant instance running separately. Then:

```bash
QDRANT_URL=http://localhost:6333 pnpm run start
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | URL of the Qdrant instance |
| `PROJECT_ROOT` | Current working directory | Used to derive the default project ID and locate the team memory profile |

## Connecting to Claude Code

Add the server to your Claude Code MCP configuration via `claude mcp add`:

```bash
claude mcp add-json docker-memory '{
  "command": "docker",
  "args": ["exec", "-i", "-e", "PROJECT_ROOT='$(pwd)'", "context-memory-mcp-server", "node", "dist/index.js"]
}'
```

Also consider adding instructions for how to use the tools in your agent's system prompt, referencing the tool names and expected inputs/outputs.
The CLAUDE.md file in this repo provides an example of how to do this.

## MCP Tools

Once connected, the AI agent has access to five tools:

### `get_current_project_id`
Returns the current project identifier derived from `$PROJECT_ROOT` or the working directory name. Call this at the start of a session to scope memories to the right project.

```
get_current_project_id()
→ "my-project"
```

### `remember_info`
Stores a piece of text with optional tags and category, scoped to a project. When a [team memory profile](#team-memory-profiles) is active, required tags and allowed categories are enforced.

```
remember_info({
  text: "The payment service uses idempotency keys to prevent duplicate charges.",
  projectId: "my-project",
  tags: ["payments", "architecture"],
  category: "Architecture Decisions"   // optional; validated against profile if one is active
})
```

### `search_memories`
Performs a semantic similarity search across stored memories. Finds relevant results even when phrasing differs from the original.

```
search_memories({
  query: "How does billing handle duplicate requests?",
  projectId: "my-project",
  limit: 5
})
→ [ID: abc-123] The payment service uses idempotency keys to prevent duplicate charges.
```

### `forget_memory`
Deletes a single memory by ID, or all memories for a project.

```
# Delete one memory
forget_memory({ memoryId: "abc-123" })

# Wipe all memories for a project
forget_memory({ projectId: "my-project" })
```

### `list_projects`
Lists all projects that have at least one stored memory.

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

- **Category is always optional** — omitting `category` is valid even when `memory_categories` is defined.

### Backward Compatibility

Projects without a `.context-memory/profile.yml` file behave exactly as before — there is no change in behavior and no configuration required for existing setups.

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
