import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import type {QdrantClient} from "@qdrant/js-client-rest";

export function registerForgetTool(server: McpServer, sharedQdrant: QdrantClient | null = null) {
  server.tool(
    "forget_memory",
    {
      memoryId: z.string().optional().describe("The UUID of the specific memory to forget"),
      projectId: z.string().optional().describe("The project ID to clear all memories for"),
      scope: z.enum(["personal", "shared", "all"]).optional().default("personal")
        .describe("Which layer to delete from: 'personal' (default), 'shared', or 'all'"),
    },
    async ({memoryId, projectId, scope: rawScope}) => {
      const scope = rawScope ?? "personal";
      if (!memoryId && !projectId) {
        return {
          isError: true,
          content: [{type: "text" as const, text: "Please provide either a memoryId or a projectId."}]
        };
      }

      if ((scope === "shared" || scope === "all") && !sharedQdrant) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Shared layer is not configured. Set QDRANT_SHARED_URL to delete from the shared layer."
          }]
        };
      }

      const deleteArgs = memoryId
        ? {points: [memoryId]}
        : {filter: {must: [{key: "projectId", match: {value: projectId!}}]}};

      const target = memoryId ? `memory: ${memoryId}` : `all memories for project: ${projectId}`;

      try {
        if (scope === "personal" || scope === "all") {
          await qdrant.delete("memories", deleteArgs);
        }

        if ((scope === "shared" || scope === "all") && sharedQdrant) {
          try {
            await sharedQdrant.delete("memories", deleteArgs);
          } catch (sharedErr: any) {
            if (scope === "all") {
              return {
                content: [{
                  type: "text" as const,
                  text: `Deleted ${target} from personal layer. Failed to delete from shared layer: ${sharedErr.message}`
                }]
              };
            }
            throw sharedErr;
          }
        }

        const layerLabel = scope === "personal" ? "personal layer" : scope === "shared" ? "shared layer" : "both layers";
        return {
          content: [{type: "text" as const, text: `Successfully deleted ${target} from ${layerLabel}.`}]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text" as const, text: `Failed to forget: ${error.message}`}]
        };
      }
    }
  );
}
