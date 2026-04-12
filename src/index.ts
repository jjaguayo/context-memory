import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {ensureCollection} from "./lib/qdrant.js";
import {loadProfile} from "./lib/profile.js";
import {registerSearchTool} from "./tools/search.js";
import {registerRememberTool} from "./tools/remember.js";
import {registerForgetTool} from "./tools/forget.js";
import {registerGetCurrent} from "./tools/get_current.js";
import {registerListProjectsTool} from "./tools/list_projects.js";

const server = new McpServer({
  name: "local-memory-layer",
  version: "1.0.0"
});

async function main() {
  try {
    // 1. Setup the Database Schema before accepting requests
    console.error("Initializing Qdrant collection...");
    await ensureCollection();

    // 2. Load team memory profile (optional — falls back to no-op if absent)
    const projectRoot = process.env.PROJECT_ROOT || process.cwd();
    const profile = await loadProfile(projectRoot);
    if (profile) {
      console.error(`[profile] Loaded profile "${profile.name}" v${profile.version}`);
    }

    // 3. Register tools
    registerSearchTool(server);
    registerRememberTool(server, profile);
    registerForgetTool(server);
    registerGetCurrent(server);
    registerListProjectsTool(server);

    // 4. Connect using Standard Input/Output (Stdio)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("Memory MCP Server running on Stdio");
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

main();
