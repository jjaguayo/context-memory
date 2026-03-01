import {describe, it, expect, beforeAll} from 'vitest';
import {getLocalEmbedding} from './lib/embeddings.js';
import {qdrant, ensureCollection} from './lib/qdrant.js';
import {v4 as uuidv4} from 'uuid';

describe('Memory Layer Integration', () => {

  beforeAll(async () => {
    // Ensure Qdrant is up and the collection is ready
    await ensureCollection();
  });

  it('should generate a 384-dimension vector', async () => {
    const vector = await getLocalEmbedding("Hello world");
    expect(vector).toBeInstanceOf(Array);
    expect(vector.length).toBe(384);
  });

  it('should store and then find a memory semantically', async () => {
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

    // Ensure we actually got results back
    expect(results.length).toBeGreaterThan(0);

    // Get the first result
    const bestMatch = results[0];

    // Use non-null assertion (!) because we just checked length > 0
    expect(bestMatch!.payload?.text).toBe(testText);
    expect(bestMatch!.score).toBeGreaterThan(0.5);
  });

  it('should forget a memory by ID', async () => {
    const id = uuidv4();
    const vector = await getLocalEmbedding("Temporary info");

    // 1. Insert
    await qdrant.upsert("memories", {
      wait: true,
      points: [{ id, vector, payload: { text: "Temporary", projectId: "test" } }]
    });

    // 2. Delete
    await qdrant.delete("memories", { points: [id] });

    // 3. Verify
    const result = await qdrant.retrieve("memories", { ids: [id] });
    expect(result.length).toBe(0);
  });
});
