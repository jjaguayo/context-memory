import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {getLocalEmbedding} from "../lib/embeddings.js";
import {v4 as uuidv4} from 'uuid';

export function registerRememberTool(server: McpServer) {
  server.tool(
    "remember_info",
    {
      text: z.string().describe("The information to remember"),
      projectId: z.string().describe("The name or ID of the current project"),
      tags: z.array(z.string()).optional().describe("Optional keywords for categorization")
    },
    async ({text, projectId, tags}) => {
      try {
        // 1. Generate the 384-dimension vector locally
        const vector = await getLocalEmbedding(text);

        // 2. Upsert into Qdrant
        await qdrant.upsert("memories", {
          wait: true,
          points: [
            {
              id: uuidv4(),
              vector: vector,
              payload: {
                text,
                projectId,
                tags: tags || [],
                timestamp: new Date().toISOString()
              }
            }
          ]
        });

        return {
          content: [{
            type: "text",
            text: `✅ Successfully remembered for project "${projectId}": ${text.substring(0, 50)}...`
          }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text", text: `Failed to store memory: ${error.message}`}]
        };
      }
    }
  );
}
