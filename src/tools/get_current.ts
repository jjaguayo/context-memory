import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";

export function registerGetCurrent(server: McpServer) {
  server.tool(
    "get_current_project_id",
    {},
    async () => {
      // 1. Try to get the path passed from the host
      // 2. Fallback to process.cwd() as a last resort
      const activePath = process.env.PROJECT_ROOT || process.cwd();
      const projectName = path.basename(activePath);

      return {
        content: [{ type: "text", text: projectName }]
      };
    }
  );
}
