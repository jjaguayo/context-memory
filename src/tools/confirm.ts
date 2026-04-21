import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import type {QdrantClient} from "@qdrant/js-client-rest";

export function registerConfirmTool(server: McpServer, sharedQdrant: QdrantClient | null = null) {
  server.tool(
    "confirm_memory",
    {
      memoryId: z.string().describe("The UUID of the memory to confirm as still valid"),
      scope: z.enum(["personal", "shared"]).optional().default("personal")
        .describe("Which layer the memory lives in: 'personal' (default) or 'shared'"),
    },
    async ({memoryId, scope: rawScope}) => {
      const scope = rawScope ?? "personal";

      if (scope === "shared" && !sharedQdrant) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Shared layer is not configured. Set QDRANT_SHARED_URL to confirm shared memories."
          }]
        };
      }

      const client = scope === "shared" ? sharedQdrant! : qdrant;

      try {
        const points = await client.retrieve("memories", {
          ids: [memoryId],
          with_payload: true,
          with_vector: true,
        });

        if (points.length === 0) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Memory ${memoryId} not found in ${scope} layer.`
            }]
          };
        }

        const point = points[0]!;
        const last_confirmed = new Date().toISOString();

        await client.upsert("memories", {
          wait: true,
          points: [{
            id: memoryId,
            vector: point.vector as number[],
            payload: {
              ...point.payload,
              last_confirmed,
            }
          }]
        });

        return {
          content: [{
            type: "text" as const,
            text: `✅ Memory ${memoryId} confirmed. Staleness clock reset.`
          }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text" as const, text: `Failed to confirm memory: ${error.message}`}]
        };
      }
    }
  );
}
