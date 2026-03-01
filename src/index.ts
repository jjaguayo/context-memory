import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {ensureCollection} from "./lib/qdrant.js";
import {registerSearchTool} from "./tools/search.js";
import {registerRememberTool} from "./tools/remember.js";
import {registerForgetTool} from "./tools/forget.js";
import {registerGetCurrent} from "./tools/get_current.js";
import {registerListProjectsTool} from "./tools/list_projects.js";

// 1. Initialize the Server
const server = new McpServer({
  name: "local-memory-layer",
  version: "1.0.0"
});

// 2. Register your custom tools
registerSearchTool(server);
registerRememberTool(server);
registerForgetTool(server);
registerGetCurrent(server);
registerListProjectsTool(server);

async function main() {
  try {
    // 3. Setup the Database Schema before accepting requests
    // Using console.error because MCP uses stdout for protocol communication
    console.error("Initializing Qdrant collection...");
    await ensureCollection();

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
