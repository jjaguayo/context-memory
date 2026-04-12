import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {v4 as uuidv4} from 'uuid';
import type {QdrantClient} from "@qdrant/js-client-rest";

export function registerPromoteTool(server: McpServer, sharedQdrant: QdrantClient | null) {
  server.tool(
    "promote_memory",
    {
      memoryId: z.string().describe("The UUID of the personal memory to promote to the shared layer")
    },
    async ({memoryId}) => {
      if (!sharedQdrant) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Shared layer is not configured. Set QDRANT_SHARED_URL to enable promotion."
          }]
        };
      }

      try {
        // Retrieve full point including vector from personal layer
        const points = await qdrant.retrieve("memories", {
          ids: [memoryId],
          with_payload: true,
          with_vector: true,
        });

        if (points.length === 0) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Memory ${memoryId} not found in personal layer.`
            }]
          };
        }

        const point = points[0]!;
        const sharedId = uuidv4();

        // Copy to shared layer with a new UUID and scope overridden to "shared"
        await sharedQdrant.upsert("memories", {
          wait: true,
          points: [{
            id: sharedId,
            vector: point.vector as number[],
            payload: {
              ...point.payload,
              scope: "shared",
            }
          }]
        });

        const projectId = point.payload?.projectId ?? "unknown";
        return {
          content: [{
            type: "text" as const,
            text: `✅ Memory ${memoryId} promoted to shared layer (shared ID: ${sharedId}) for project "${projectId}".`
          }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text" as const, text: `Failed to promote memory: ${error.message}`}]
        };
      }
    }
  );
}
