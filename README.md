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
| `PROJECT_ROOT` | Current working directory | Used to derive the default project ID |

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
Stores a piece of text with optional tags, scoped to a project.

```
remember_info({
  text: "The payment service uses idempotency keys to prevent duplicate charges.",
  projectId: "my-project",
  tags: ["payments", "architecture"]
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
  tags      : string[]      — optional keywords
  timestamp : ISO 8601      — when the memory was created
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
