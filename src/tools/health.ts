import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {qdrant} from "../lib/qdrant.js";
import {computeConfidence, getDaysSince, getHealthLabel, resolveThreshold} from "../lib/confidence.js";
import type {MemoryProfile} from "../lib/profile.js";
import type {QdrantClient} from "@qdrant/js-client-rest";

async function scrollAllForProject(client: QdrantClient, projectId: string): Promise<any[]> {
  const points: any[] = [];
  let offset: string | number | null | undefined = undefined;

  do {
    const response = await client.scroll("memories", {
      filter: {must: [{key: "projectId", match: {value: projectId}}]},
      with_payload: true,
      with_vector: false,
      limit: 100,
      ...(offset != null && {offset}),
    });
    points.push(...response.points);
    offset = response.next_page_offset ?? null;
  } while (offset != null);

  return points;
}

interface HealthResult {
  id: string;
  confidence: number;
  daysSince: number;
  label: 'STALE' | 'AGING';
  author: string;
  preview: string;
  layerLabel: string;
}

/**
 * Core health check logic — queryable from both the MCP tool and the startup sequence.
 * Does NOT enforce the sharedQdrant-null check; callers are responsible for that.
 */
export async function runHealthCheck(
  projectId: string,
  scope: 'personal' | 'shared' | 'all',
  sharedQdrant: QdrantClient | null,
  profile: MemoryProfile | null,
  hasSharedConfigured: boolean
): Promise<string> {
  const allPoints: {point: any; layer: 'personal' | 'shared'}[] = [];
  let sharedWarning = '';

  if (scope === 'personal' || scope === 'all') {
    const points = await scrollAllForProject(qdrant, projectId);
    points.forEach(p => allPoints.push({point: p, layer: 'personal'}));
  }

  if ((scope === 'shared' || scope === 'all') && sharedQdrant) {
    try {
      const points = await scrollAllForProject(sharedQdrant, projectId);
      points.forEach(p => allPoints.push({point: p, layer: 'shared'}));
    } catch (err: any) {
      console.error(`[health] Shared layer unreachable: ${err.message}`);
      sharedWarning = `\n\n⚠️ Could not reach shared layer: ${err.message}`;
    }
  }

  const results: HealthResult[] = [];

  for (const {point, layer} of allPoints) {
    const payload = point.payload ?? {};
    const category = typeof payload.category === 'string' ? payload.category : undefined;
    const thresholdDays = resolveThreshold(category, profile);

    // Resolve last_confirmed: stored value → fallback to timestamp → fallback to now (healthy)
    const lastConfirmed: string =
      typeof payload.last_confirmed === 'string' ? payload.last_confirmed :
      typeof payload.timestamp === 'string' ? payload.timestamp :
      new Date().toISOString();

    const confidence = computeConfidence(lastConfirmed, thresholdDays);

    if (confidence < 0.5) {
      const daysSince = getDaysSince(lastConfirmed);
      const label = getHealthLabel(confidence);
      const author = typeof payload.author === 'string' ? payload.author : 'unknown';
      const text = typeof payload.text === 'string' ? payload.text : '';
      const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
      const layerLabel = hasSharedConfigured ? ` [${layer}]` : '';

      results.push({id: String(point.id), confidence, daysSince, label, author, preview, layerLabel});
    }
  }

  if (results.length === 0) {
    return `✅ All memories for project "${projectId}" are healthy.${sharedWarning}`;
  }

  // Sort ascending by confidence — most stale (0) first
  results.sort((a, b) => a.confidence - b.confidence);

  const lines = results.map(r =>
    `[${r.label} - ${r.daysSince} days] ${r.id}${r.layerLabel} (author: ${r.author}) "${r.preview}"`
  );

  return lines.join('\n---\n') + sharedWarning;
}

export function registerHealthTool(
  server: McpServer,
  sharedQdrant: QdrantClient | null = null,
  profile: MemoryProfile | null = null
) {
  server.tool(
    "memory_health",
    {
      projectId: z.string().describe("The project ID to check memory health for"),
      scope: z.enum(["personal", "shared", "all"]).optional().default("personal")
        .describe("Which layer(s) to check: 'personal' (default), 'shared', or 'all'"),
    },
    async ({projectId, scope: rawScope}) => {
      const scope = rawScope ?? "personal";

      if ((scope === "shared" || scope === "all") && !sharedQdrant) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Shared layer is not configured. Set QDRANT_SHARED_URL to check shared memories."
          }]
        };
      }

      try {
        const text = await runHealthCheck(
          projectId,
          scope,
          sharedQdrant,
          profile,
          sharedQdrant !== null
        );
        return {content: [{type: "text" as const, text}]};
      } catch (error: any) {
        return {
          isError: true,
          content: [{type: "text" as const, text: `Failed to check memory health: ${error.message}`}]
        };
      }
    }
  );
}
