import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';

const RetentionSchema = z.object({
  default_days: z.number().int().positive().optional(),
  per_category: z.record(z.string(), z.number().int().positive()).optional(),
});

export const MemoryProfileSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  required_tags: z.array(z.string()).optional().default([]),
  memory_categories: z.array(z.string()).optional().default([]),
  retention: RetentionSchema.optional(),
  auto_promote_tags: z.array(z.string()).optional().default([]),
  health_check_on_start: z.boolean().optional().default(false),
});

export type MemoryProfile = z.infer<typeof MemoryProfileSchema>;

export async function loadProfile(projectRoot: string): Promise<MemoryProfile | null> {
  const profilePath = join(projectRoot, '.context-memory', 'profile.yml');

  let raw: string;
  try {
    raw = await readFile(profilePath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    console.error(`[profile] Could not read profile file: ${err.message}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err: any) {
    console.error(`[profile] Failed to parse YAML in ${profilePath}: ${err.message}`);
    return null;
  }

  const result = MemoryProfileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    console.error(`[profile] Invalid profile schema in ${profilePath}: ${issues}`);
    return null;
  }

  return result.data;
}

/**
 * Validates tags and category against an active profile.
 * Returns an error message string if validation fails, or null if valid.
 */
export function validateAgainstProfile(
  tags: string[],
  category: string | undefined,
  profile: MemoryProfile
): string | null {
  const requiredTags = profile.required_tags ?? [];
  if (requiredTags.length > 0) {
    const missingTags = requiredTags.filter(t => !tags.includes(t));
    if (missingTags.length > 0) {
      return `Missing required tags: [${missingTags.join(', ')}]. Profile: ${profile.name} v${profile.version}`;
    }
  }

  if (category !== undefined) {
    const allowedCategories = profile.memory_categories ?? [];
    if (allowedCategories.length > 0 && !allowedCategories.includes(category)) {
      return `Invalid category '${category}'. Allowed categories: [${allowedCategories.join(', ')}]. Profile: ${profile.name} v${profile.version}`;
    }
  }

  return null;
}
