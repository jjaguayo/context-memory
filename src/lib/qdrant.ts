import {QdrantClient} from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
export const qdrant = new QdrantClient({url: QDRANT_URL});

export async function ensureCollection() {
  const collectionName = "memories";
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === collectionName);

    if (!exists) {
      console.error(`Creating collection: ${collectionName}...`);
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: 384, // Matches Xenova/all-MiniLM-L6-v2
          distance: "Cosine"
        }
      });
      console.error(`Collection ${collectionName} created successfully.`);
    }
  } catch (error) {
    console.error("Failed to check/create Qdrant collection:", error);
    throw error; // Crash early if the DB isn't ready
  }
}
