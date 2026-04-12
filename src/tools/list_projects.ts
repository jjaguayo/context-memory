import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {qdrant} from "../lib/qdrant.js";
import type {QdrantClient} from "@qdrant/js-client-rest";

export function registerListProjectsTool(server: McpServer, sharedQdrant: QdrantClient | null = null) {
  server.tool(
    "list_projects",
    {},
    async () => {
      try {
        // Query both layers in parallel; shared failure degrades silently
        const [personalResponse, sharedResponse] = await Promise.all([
          qdrant.scroll("memories", {with_payload: ["projectId"], limit: 100}),
          sharedQdrant
            ? sharedQdrant.scroll("memories", {with_payload: ["projectId"], limit: 100}).catch(() => ({points: []}))
            : Promise.resolve({points: []}),
        ]);

        const projectIds = new Set<string>();
        [...personalResponse.points, ...sharedResponse.points].forEach(point => {
          const id = point.payload?.projectId;
          if (typeof id === "string") projectIds.add(id);
        });

        const projectList = Array.from(projectIds).sort();

        if (projectList.length === 0) {
          return {
            content: [{type: "text" as const, text: "No projects found in memory yet."}]
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Projects with existing memories:\n- ${projectList.join("\n- ")}`
          }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text" as const, text: `Failed to list projects: ${error.message}`}]
        };
      }
    }
  );
}
