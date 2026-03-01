import { pipeline, env } from '@xenova/transformers';

/**
 * THE SHARP BYPASS:
 * Needed when running in environments where 'sharp' and 'onnxruntime-node' cannot be installed.
 */
if (typeof process !== 'undefined') {
  (env as any).isNode = false;
}

// Disable searching for local native models/libraries
env.allowLocalModels = false;
env.allowRemoteModels = true;

// Configure the WASM backend for stability in Docker
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;

let embedder: any = null;
let embedderModel = 'Xenova/all-MiniLM-L6-v2';

/**
 * Generates a 384-dimension vector using a local-compatible WASM model.
 */
export async function getLocalEmbedding(text: string): Promise<number[]> {
  try {
    if (!embedder) {
      // Xenova/all-MiniLM-L6-v2 is the industry standard for fast, local text embeddings
      embedder = await pipeline('feature-extraction', embedderModel);
    }

    const output = await embedder(text, {
      pooling: 'mean',
      normalize: true
    });

    // Convert the Tensor output to a standard Javascript array
    return Array.from(output.data as Float32Array);
  } catch (error) {
    console.error("Critical Embedding Error:", error);
    throw error;
  }
}
