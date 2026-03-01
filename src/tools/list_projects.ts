import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { qdrant } from "../lib/qdrant.js";

export function registerListProjectsTool(server: McpServer) {
  server.tool(
    "list_projects",
    {}, // No arguments needed
    async () => {
      try {
        // We use scroll to get points without a vector query
        const response = await qdrant.scroll("memories", {
          with_payload: ["projectId"], // Only fetch the projectId to save bandwidth
          limit: 100, // Adjust if you have hundreds of projects
        });

        // Extract unique project IDs using a Set
        const projectIds = new Set<string>();
        response.points.forEach((point) => {
          const id = point.payload?.projectId;
          if (typeof id === "string") {
            projectIds.add(id);
          }
        });

        const projectList = Array.from(projectIds);

        if (projectList.length === 0) {
          return {
            content: [{ type: "text", text: "No projects found in memory yet." }]
          };
        }

        return {
          content: [{
            type: "text",
            text: `Projects with existing memories:\n- ${projectList.join("\n- ")}`
          }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list projects: ${error.message}` }]
        };
      }
    }
  );
}
