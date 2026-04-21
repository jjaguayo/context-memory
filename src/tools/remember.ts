import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {getLocalEmbedding} from "../lib/embeddings.js";
import {v4 as uuidv4} from 'uuid';
import {type MemoryProfile, validateAgainstProfile} from "../lib/profile.js";
import type {QdrantClient} from "@qdrant/js-client-rest";

export function registerRememberTool(
  server: McpServer,
  profile: MemoryProfile | null = null,
  sharedQdrant: QdrantClient | null = null,
  author: string = 'unknown',
  sessionId: string = uuidv4()
) {
  server.tool(
    "remember_info",
    {
      text: z.string().describe("The information to remember"),
      projectId: z.string().describe("The name or ID of the current project"),
      tags: z.array(z.string()).optional().describe("Keywords for categorization. Required tags are enforced when a team profile is active."),
      category: z.string().optional().describe("Memory category (e.g. 'Architecture Decisions'). Must match an allowed category when a team profile is active."),
      source_file: z.string().optional().describe("Optional file path hint — the source file this memory relates to (e.g. 'src/payments/service.ts')."),
    },
    async ({text, projectId, tags, category, source_file}) => {
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

        const memoryId = uuidv4();
        const vector = await getLocalEmbedding(text);
        const timestamp = new Date().toISOString();
        const storedTags = tags || [];

        // Store in personal layer with provenance fields
        await qdrant.upsert("memories", {
          wait: true,
          points: [{
            id: memoryId,
            vector,
            payload: {
              text,
              projectId,
              tags: storedTags,
              timestamp,
              scope: "personal",
              author,
              session_id: sessionId,
              last_confirmed: timestamp,
              ...(category !== undefined && {category}),
              ...(source_file !== undefined && {source_file}),
            }
          }]
        });

        // Auto-promote if tags match profile's auto_promote_tags
        if (profile && sharedQdrant && (profile.auto_promote_tags ?? []).length > 0) {
          const matchedTag = storedTags.find(t => profile.auto_promote_tags!.includes(t));
          if (matchedTag) {
            try {
              await sharedQdrant.upsert("memories", {
                wait: true,
                points: [{
                  id: uuidv4(),
                  vector,
                  payload: {
                    text,
                    projectId,
                    tags: storedTags,
                    timestamp,
                    scope: "shared",
                    author,
                    session_id: sessionId,
                    last_confirmed: timestamp,
                    ...(category !== undefined && {category}),
                    ...(source_file !== undefined && {source_file}),
                  }
                }]
              });
              return {
                content: [{
                  type: "text" as const,
                  text: `✅ Remembered for project "${projectId}" and auto-promoted to shared (tag: ${matchedTag}): ${text.substring(0, 50)}...`
                }]
              };
            } catch (err: any) {
              console.error(`[shared] Auto-promotion failed: ${err.message}`);
            }
          }
        }

        // Log warning if auto_promote_tags matched but shared layer not configured
        if (profile && !sharedQdrant && (profile.auto_promote_tags ?? []).length > 0) {
          const matchedTag = storedTags.find(t => profile.auto_promote_tags!.includes(t));
          if (matchedTag) {
            console.error(`[shared] Auto-promotion skipped for tag "${matchedTag}": QDRANT_SHARED_URL not configured.`);
          }
        }

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
