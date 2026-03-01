import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // In newer Vitest versions, 'inline' moved to 'server.deps'
        server: {
            deps: {
                inline: [/@xenova\/transformers/]
            }
        },
        // This helps Vitest handle the ESM/CJS interop for ONNX
        pool: 'forks'
    },
});
