import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadProfile, validateAgainstProfile, type MemoryProfile } from './profile.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testRoot: string;

beforeEach(async () => {
  testRoot = join(tmpdir(), `profile-test-${Date.now()}`);
  await mkdir(join(testRoot, '.context-memory'), { recursive: true });
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function writeProfile(content: string) {
  await writeFile(join(testRoot, '.context-memory', 'profile.yml'), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// loadProfile()
// ---------------------------------------------------------------------------

describe('loadProfile()', () => {
  it('returns null when no profile file exists', async () => {
    const profile = await loadProfile(testRoot);
    expect(profile).toBeNull();
  });

  it('returns null and does not throw when YAML is invalid', async () => {
    await writeProfile('version: [\nbad yaml{{');
    const profile = await loadProfile(testRoot);
    expect(profile).toBeNull();
  });

  it('returns null when version is not supported', async () => {
    await writeProfile('version: 2\nname: future-profile');
    const profile = await loadProfile(testRoot);
    expect(profile).toBeNull();
  });

  it('returns null when required field "name" is missing', async () => {
    await writeProfile('version: 1');
    const profile = await loadProfile(testRoot);
    expect(profile).toBeNull();
  });

  it('parses a minimal valid profile with defaults applied', async () => {
    await writeProfile('version: 1\nname: minimal');
    const profile = await loadProfile(testRoot);
    expect(profile).not.toBeNull();
    expect(profile!.version).toBe(1);
    expect(profile!.name).toBe('minimal');
    expect(profile!.required_tags).toEqual([]);
    expect(profile!.memory_categories).toEqual([]);
    expect(profile!.auto_promote_tags).toEqual([]);
  });

  it('parses a full profile with all fields', async () => {
    await writeProfile(`
version: 1
name: acme-eng-standard
required_tags:
  - service
  - type
memory_categories:
  - Architecture Decisions
  - Known Gotchas
retention:
  default_days: 90
  per_category:
    Architecture Decisions: 365
auto_promote_tags:
  - architecture
`);
    const profile = await loadProfile(testRoot);
    expect(profile).not.toBeNull();
    expect(profile!.required_tags).toEqual(['service', 'type']);
    expect(profile!.memory_categories).toEqual(['Architecture Decisions', 'Known Gotchas']);
    expect(profile!.retention?.default_days).toBe(90);
    expect(profile!.retention?.per_category?.['Architecture Decisions']).toBe(365);
    expect(profile!.auto_promote_tags).toEqual(['architecture']);
  });

  it('parses health_check_on_start when set to true', async () => {
    await writeProfile('version: 1\nname: test\nhealth_check_on_start: true');
    const profile = await loadProfile(testRoot);
    expect(profile).not.toBeNull();
    expect(profile!.health_check_on_start).toBe(true);
  });

  it('defaults health_check_on_start to false when absent', async () => {
    await writeProfile('version: 1\nname: test');
    const profile = await loadProfile(testRoot);
    expect(profile!.health_check_on_start).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAgainstProfile()
// ---------------------------------------------------------------------------

describe('validateAgainstProfile()', () => {
  const profile: MemoryProfile = {
    version: 1,
    name: 'acme-eng-standard',
    required_tags: ['service', 'type'],
    memory_categories: ['Architecture Decisions', 'Known Gotchas'],
    auto_promote_tags: [],
  };

  it('returns null when all required tags are present', () => {
    const result = validateAgainstProfile(['service', 'type'], undefined, profile);
    expect(result).toBeNull();
  });

  it('returns an error message listing missing tags', () => {
    const result = validateAgainstProfile(['service'], undefined, profile);
    expect(result).toMatch(/Missing required tags: \[type\]/);
    expect(result).toMatch(/acme-eng-standard v1/);
  });

  it('returns an error listing all missing tags when multiple are absent', () => {
    const result = validateAgainstProfile([], undefined, profile);
    expect(result).toMatch(/service/);
    expect(result).toMatch(/type/);
  });

  it('returns null when a valid category is provided', () => {
    const result = validateAgainstProfile(['service', 'type'], 'Architecture Decisions', profile);
    expect(result).toBeNull();
  });

  it('returns an error for an invalid category', () => {
    const result = validateAgainstProfile(['service', 'type'], 'Misc', profile);
    expect(result).toMatch(/Invalid category 'Misc'/);
    expect(result).toMatch(/Architecture Decisions/);
    expect(result).toMatch(/acme-eng-standard v1/);
  });

  it('returns null when category is omitted even if memory_categories is defined', () => {
    const result = validateAgainstProfile(['service', 'type'], undefined, profile);
    expect(result).toBeNull();
  });

  it('tag matching is case-sensitive', () => {
    const result = validateAgainstProfile(['Service', 'type'], undefined, profile);
    expect(result).toMatch(/Missing required tags: \[service\]/);
  });

  it('returns null when profile has no required_tags or memory_categories', () => {
    const emptyProfile: MemoryProfile = {
      version: 1,
      name: 'open',
      required_tags: [],
      memory_categories: [],
      auto_promote_tags: [],
    };
    const result = validateAgainstProfile([], 'anything', emptyProfile);
    expect(result).toBeNull();
  });
});
