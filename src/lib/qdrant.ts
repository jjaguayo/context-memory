import {QdrantClient} from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
export const qdrant = new QdrantClient({url: QDRANT_URL});

const QDRANT_SHARED_URL = process.env.QDRANT_SHARED_URL;
export const sharedQdrant: QdrantClient | null = QDRANT_SHARED_URL
  ? new QdrantClient({url: QDRANT_SHARED_URL})
  : null;

const COLLECTION = "memories";
const VECTOR_CONFIG = {size: 384, distance: "Cosine"} as const;

async function ensureNamedCollection(client: QdrantClient, label: string): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === COLLECTION);
  if (!exists) {
    console.error(`${label} Creating collection: ${COLLECTION}...`);
    await client.createCollection(COLLECTION, {vectors: VECTOR_CONFIG});
    console.error(`${label} Collection ${COLLECTION} created successfully.`);
  }
}

export async function ensureCollection(): Promise<void> {
  try {
    await ensureNamedCollection(qdrant, "[personal]");
  } catch (error) {
    console.error("Failed to check/create Qdrant collection:", error);
    throw error;
  }
}

export async function ensureSharedCollection(): Promise<void> {
  if (!sharedQdrant) return;
  try {
    await ensureNamedCollection(sharedQdrant, "[shared]");
  } catch (error) {
    console.error("[shared] Failed to check/create Qdrant collection:", error);
    throw error;
  }
}
