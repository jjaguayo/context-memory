import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {getLocalEmbedding} from "../lib/embeddings.js";
// 1. Import the Filter type
import type {Schemas} from "@qdrant/js-client-rest";

export function registerSearchTool(server: McpServer) {
  server.tool(
    "search_memories",
    {
      query: z.string(),
      projectId: z.string().optional().describe("Filter by a specific project name or ID"),
      limit: z.number().default(5)
    },
    async ({query, projectId, limit}) => {
      const vector = await getLocalEmbedding(query);

      // 2. Explicitly define the filter type
      let filter: Schemas["Filter"] | undefined = undefined;

      if (projectId) {
        filter = {
          must: [
            {
              key: "projectId",
              match: {value: projectId}
            }
          ]
        };
      }

      const searchParams = {
        vector,
        limit,
        with_payload: true,
        ...(filter && {filter})
      };

      const results = await qdrant.search("memories", searchParams);

      // Inside search_memories tool mapping
      const formatted = results
        .map(res => `[ID: ${res.id}] [Project: ${res.payload?.projectId}] ${res.payload?.text}`)
        .join("\n---\n");

      return {
        content: [{type: "text", text: formatted || "No matching memories found."}]
      };
    }
  );
}
