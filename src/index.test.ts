import {describe, it, expect, beforeAll} from 'vitest';
import {getLocalEmbedding} from './lib/embeddings.js';
import {qdrant, ensureCollection} from './lib/qdrant.js';
import {v4 as uuidv4} from 'uuid';
import {validateAgainstProfile, type MemoryProfile} from './lib/profile.js';

// ---------------------------------------------------------------------------
// Embedding (no Qdrant required)
// ---------------------------------------------------------------------------

describe('Embedding', () => {
  it('should generate a 384-dimension vector', async () => {
    const vector = await getLocalEmbedding("Hello world");
    expect(vector).toBeInstanceOf(Array);
    expect(vector.length).toBe(384);
  });
});

// ---------------------------------------------------------------------------
// Qdrant integration (requires a running Qdrant instance)
// ---------------------------------------------------------------------------

let qdrantReady = false;

describe('Memory Layer Integration', () => {

  beforeAll(async () => {
    try {
      await ensureCollection();
      qdrantReady = true;
    } catch {
      console.warn('[test] Qdrant not available — Qdrant integration tests will be skipped');
    }
  });

  it('should store and then find a memory semantically', async (ctx) => {
    if (!qdrantReady) return ctx.skip();

    const testText = "The secret ingredient is cinnamon.";
    const projectId = "test-project";
    const vector = await getLocalEmbedding(testText);

    // 1. Store
    await qdrant.upsert("memories", {
      wait: true,
      points: [{
        id: uuidv4(),
        vector,
        payload: {text: testText, projectId}
      }]
    });

    // 2. Search using a DIFFERENT but related phrase
    const searchVector = await getLocalEmbedding("What is in the recipe?");
    const results = await qdrant.search("memories", {
      vector: searchVector,
      filter: {
        must: [{key: "projectId", match: {value: projectId}}]
      },
      limit: 1
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.payload?.text).toBe(testText);
    expect(results[0]!.score).toBeGreaterThan(0.5);
  });

  it('should store a memory with a category field', async (ctx) => {
    if (!qdrantReady) return ctx.skip();

    const id = uuidv4();
    const vector = await getLocalEmbedding("Auth uses RS256 tokens");

    await qdrant.upsert("memories", {
      wait: true,
      points: [{
        id,
        vector,
        payload: {text: "Auth uses RS256 tokens", projectId: "test-project", tags: ["auth"], category: "Architecture Decisions", timestamp: new Date().toISOString()}
      }]
    });

    const result = await qdrant.retrieve("memories", {ids: [id], with_payload: true});
    expect(result[0]?.payload?.category).toBe("Architecture Decisions");

    await qdrant.delete("memories", {points: [id]});
  });

  it('should forget a memory by ID', async (ctx) => {
    if (!qdrantReady) return ctx.skip();

    const id = uuidv4();
    const vector = await getLocalEmbedding("Temporary info");

    await qdrant.upsert("memories", {
      wait: true,
      points: [{id, vector, payload: {text: "Temporary", projectId: "test"}}]
    });

    await qdrant.delete("memories", {points: [id]});

    const result = await qdrant.retrieve("memories", {ids: [id]});
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Profile enforcement (no Qdrant required)
// ---------------------------------------------------------------------------

describe('Profile enforcement (validateAgainstProfile)', () => {
  const profile: MemoryProfile = {
    version: 1,
    name: 'acme-eng-standard',
    required_tags: ['service', 'type'],
    memory_categories: ['Architecture Decisions', 'Known Gotchas'],
    auto_promote_tags: [],
  };

  it('passes when all required tags are present and no category provided', () => {
    expect(validateAgainstProfile(['service', 'type'], undefined, profile)).toBeNull();
  });

  it('fails with actionable message when a required tag is missing', () => {
    const err = validateAgainstProfile(['service'], undefined, profile);
    expect(err).toMatch(/Missing required tags: \[type\]/);
    expect(err).toMatch(/acme-eng-standard v1/);
  });

  it('fails when category does not match allowed list', () => {
    const err = validateAgainstProfile(['service', 'type'], 'Misc', profile);
    expect(err).toMatch(/Invalid category 'Misc'/);
    expect(err).toMatch(/Architecture Decisions/);
  });

  it('passes when category is omitted even though profile defines memory_categories', () => {
    expect(validateAgainstProfile(['service', 'type'], undefined, profile)).toBeNull();
  });

  it('passes with a valid category', () => {
    expect(validateAgainstProfile(['service', 'type'], 'Known Gotchas', profile)).toBeNull();
  });
});
