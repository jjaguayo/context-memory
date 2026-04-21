import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {basename} from "path";
import {v4 as uuidv4} from 'uuid';
import {ensureCollection, ensureSharedCollection, sharedQdrant} from "./lib/qdrant.js";
import {loadProfile} from "./lib/profile.js";
import {registerSearchTool} from "./tools/search.js";
import {registerRememberTool} from "./tools/remember.js";
import {registerForgetTool} from "./tools/forget.js";
import {registerGetCurrent} from "./tools/get_current.js";
import {registerListProjectsTool} from "./tools/list_projects.js";
import {registerPromoteTool} from "./tools/promote.js";
import {registerConfirmTool} from "./tools/confirm.js";
import {registerHealthTool, runHealthCheck} from "./tools/health.js";

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

    // 4. Resolve provenance fields once at startup
    const sessionId = uuidv4();
    const author = process.env.GIT_AUTHOR_NAME ?? process.env.USER ?? 'unknown';

    // 5. Register tools
    registerSearchTool(server, sharedQdrant);
    registerRememberTool(server, profile, sharedQdrant, author, sessionId);
    registerForgetTool(server, sharedQdrant);
    registerGetCurrent(server);
    registerListProjectsTool(server, sharedQdrant);
    registerPromoteTool(server, sharedQdrant);
    registerConfirmTool(server, sharedQdrant);
    registerHealthTool(server, sharedQdrant, profile);

    // 6. Startup health check (if enabled in profile)
    if (profile?.health_check_on_start) {
      try {
        const projectId = basename(projectRoot);
        const checkScope = sharedQdrant ? 'all' : 'personal';
        const healthText = await runHealthCheck(projectId, checkScope, sharedQdrant, profile, sharedQdrant !== null);
        if (healthText.startsWith('✅')) {
          console.error(`[health] ${healthText}`);
        } else {
          console.error(`[health] Memories need review for project "${projectId}":\n${healthText}`);
        }
      } catch (err: any) {
        console.error(`[health] Startup health check failed: ${err.message}`);
      }
    }

    // 7. Connect using Standard Input/Output (Stdio)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("Memory MCP Server running on Stdio");
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

main();
