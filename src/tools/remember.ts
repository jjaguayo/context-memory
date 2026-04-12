import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {getLocalEmbedding} from "../lib/embeddings.js";
import {v4 as uuidv4} from 'uuid';
import {type MemoryProfile, validateAgainstProfile} from "../lib/profile.js";

export function registerRememberTool(server: McpServer, profile: MemoryProfile | null = null) {
  server.tool(
    "remember_info",
    {
      text: z.string().describe("The information to remember"),
      projectId: z.string().describe("The name or ID of the current project"),
      tags: z.array(z.string()).optional().describe("Keywords for categorization. Required tags are enforced when a team profile is active."),
      category: z.string().optional().describe("Memory category (e.g. 'Architecture Decisions'). Must match an allowed category when a team profile is active.")
    },
    async ({text, projectId, tags, category}) => {
      try {
        // Enforce team profile rules before storing
        if (profile) {
          const validationError = validateAgainstProfile(tags ?? [], category, profile);
          if (validationError) {
            return {
              isError: true,
              content: [{type: "text" as const, text: validationError}]
            };
          }
        }

        // Generate the 384-dimension vector locally
        const vector = await getLocalEmbedding(text);

        // Upsert into Qdrant
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
                timestamp: new Date().toISOString(),
                ...(category !== undefined && {category})
              }
            }
          ]
        });

        return {
          content: [{
            type: "text" as const,
            text: `✅ Successfully remembered for project "${projectId}": ${text.substring(0, 50)}...`
          }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text" as const, text: `Failed to store memory: ${error.message}`}]
        };
      }
    }
  );
}
