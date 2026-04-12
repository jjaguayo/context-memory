import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {getLocalEmbedding} from "../lib/embeddings.js";
import type {Schemas, QdrantClient} from "@qdrant/js-client-rest";

export function registerSearchTool(server: McpServer, sharedQdrant: QdrantClient | null = null) {
  server.tool(
    "search_memories",
    {
      query: z.string(),
      projectId: z.string().optional().describe("Filter by a specific project name or ID"),
      limit: z.number().default(5)
    },
    async ({query, projectId, limit}) => {
      const vector = await getLocalEmbedding(query);

      let filter: Schemas["Filter"] | undefined = undefined;
      if (projectId) {
        filter = {
          must: [{key: "projectId", match: {value: projectId}}]
        };
      }

      const searchParams = {
        vector,
        limit,
        with_payload: true,
        ...(filter && {filter})
      };

      // Query both layers in parallel; shared layer failure degrades silently
      const [personalResults, sharedResults] = await Promise.all([
        qdrant.search("memories", searchParams),
        sharedQdrant
          ? sharedQdrant.search("memories", searchParams).catch((err: Error) => {
              console.error(`[shared] Unreachable — returning personal results only: ${err.message}`);
              return [];
            })
          : Promise.resolve([]),
      ]);

      // Merge and sort by score descending, apply limit to merged list
      type LayeredResult = (typeof personalResults)[number] & {_layer: "personal" | "shared"};
      const merged: LayeredResult[] = [
        ...personalResults.map(r => ({...r, _layer: "personal" as const})),
        ...sharedResults.map(r => ({...r, _layer: "shared" as const})),
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const formatted = merged
        .map(res => {
          const layerLabel = sharedQdrant ? ` [${res._layer}]` : "";
          return `[ID: ${res.id}]${layerLabel} [Project: ${res.payload?.projectId}] ${res.payload?.text}`;
        })
        .join("\n---\n");

      return {
        content: [{type: "text", text: formatted || "No matching memories found."}]
      };
    }
  );
}
