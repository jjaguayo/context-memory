import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {ensureCollection, ensureSharedCollection, sharedQdrant} from "./lib/qdrant.js";
import {loadProfile} from "./lib/profile.js";
import {registerSearchTool} from "./tools/search.js";
import {registerRememberTool} from "./tools/remember.js";
import {registerForgetTool} from "./tools/forget.js";
import {registerGetCurrent} from "./tools/get_current.js";
import {registerListProjectsTool} from "./tools/list_projects.js";
import {registerPromoteTool} from "./tools/promote.js";

const server = new McpServer({
  name: "local-memory-layer",
  version: "1.0.0"
});

async function main() {
  try {
    // 1. Setup personal collection
    console.error("Initializing Qdrant collection...");
    await ensureCollection();

    // 2. Setup shared collection (no-op if QDRANT_SHARED_URL not set)
    await ensureSharedCollection();
    if (sharedQdrant) {
      console.error(`[shared] Connected to shared layer at ${process.env.QDRANT_SHARED_URL}`);
    }

    // 3. Load team memory profile (optional — falls back to no-op if absent)
    const projectRoot = process.env.PROJECT_ROOT || process.cwd();
    const profile = await loadProfile(projectRoot);
    if (profile) {
      console.error(`[profile] Loaded profile "${profile.name}" v${profile.version}`);
    }

    // 4. Register tools
    registerSearchTool(server, sharedQdrant);
    registerRememberTool(server, profile, sharedQdrant);
    registerForgetTool(server, sharedQdrant);
    registerGetCurrent(server);
    registerListProjectsTool(server, sharedQdrant);
    registerPromoteTool(server, sharedQdrant);

    // 5. Connect using Standard Input/Output (Stdio)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("Memory MCP Server running on Stdio");
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

main();
