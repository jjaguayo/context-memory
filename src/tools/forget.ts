import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { qdrant } from "../lib/qdrant.js";

export function registerForgetTool(server: McpServer) {
  server.tool(
    "forget_memory",
    {
      memoryId: z.string().optional().describe("The UUID of the specific memory to forget"),
      projectId: z.string().optional().describe("The project ID to clear all memories for"),
    },
    async ({ memoryId, projectId }) => {
      try {
        if (memoryId) {
          // Delete a single specific point
          await qdrant.delete("memories", {
            points: [memoryId],
          });
          return {
            content: [{ type: "text", text: `Successfully deleted memory: ${memoryId}` }]
          };
        }

        if (projectId) {
          // Delete all points matching the projectId filter
          await qdrant.delete("memories", {
            filter: {
              must: [{ key: "projectId", match: { value: projectId } }]
            }
          });
          return {
            content: [{ type: "text", text: `Successfully cleared all memories for project: ${projectId}` }]
          };
        }

        return {
          isError: true,
          content: [{ type: "text", text: "Please provide either a memoryId or a projectId." }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to forget: ${error.message}` }]
        };
      }
    }
  );
}
