import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// vi.mock is hoisted — these run before any imports below
vi.mock('../lib/qdrant.js', () => ({
  qdrant: {
    upsert: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({}),
    scroll: vi.fn().mockResolvedValue({points: []}),
  },
  ensureCollection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/embeddings.js', () => ({
  getLocalEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
}));

import {qdrant} from '../lib/qdrant.js';
import {getLocalEmbedding} from '../lib/embeddings.js';
import {registerRememberTool} from './remember.js';
import {registerSearchTool} from './search.js';
import {registerForgetTool} from './forget.js';
import {registerGetCurrent} from './get_current.js';
import {registerListProjectsTool} from './list_projects.js';
import type {MemoryProfile} from '../lib/profile.js';

// ---------------------------------------------------------------------------
// Minimal server stub — captures registered tool handlers so we can call them
// directly without going through the MCP transport layer.
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: {type: string; text: string}[];
}>;

class MockServer {
  private handlers = new Map<string, ToolHandler>();

  tool(name: string, _schema: unknown, handler: ToolHandler) {
    this.handlers.set(name, handler);
  }

  async call(name: string, args: Record<string, unknown> = {}) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Tool "${name}" not registered`);
    return handler(args);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer() {
  return new MockServer() as unknown as Parameters<typeof registerRememberTool>[0];
}

const baseProfile: MemoryProfile = {
  version: 1,
  name: 'test-profile',
  required_tags: ['service', 'type'],
  memory_categories: ['Architecture Decisions', 'Known Gotchas'],
  auto_promote_tags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// remember_info
// ---------------------------------------------------------------------------

describe('remember_info', () => {
  it('stores a memory and returns a success message', async () => {
    const server = new MockServer();
    registerRememberTool(server as any);

    const result = await server.call('remember_info', {
      text: 'The payment service uses idempotency keys.',
      projectId: 'my-project',
      tags: ['payments'],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toMatch(/Successfully remembered/);
    expect(vi.mocked(qdrant.upsert)).toHaveBeenCalledOnce();
  });

  it('stores category in the Qdrant payload when provided', async () => {
    const server = new MockServer();
    registerRememberTool(server as any);

    await server.call('remember_info', {
      text: 'Auth uses RS256.',
      projectId: 'my-project',
      tags: ['auth'],
      category: 'Architecture Decisions',
    });

    const upsertCall = vi.mocked(qdrant.upsert).mock.calls[0]!;
    const payload = (upsertCall[1] as any).points[0].payload;
    expect(payload.category).toBe('Architecture Decisions');
  });

  it('does not include category key when category is omitted', async () => {
    const server = new MockServer();
    registerRememberTool(server as any);

    await server.call('remember_info', {
      text: 'No category here.',
      projectId: 'my-project',
    });

    const upsertCall = vi.mocked(qdrant.upsert).mock.calls[0]!;
    const payload = (upsertCall[1] as any).points[0].payload;
    expect(Object.keys(payload)).not.toContain('category');
  });

  it('generates an embedding from the provided text', async () => {
    const server = new MockServer();
    registerRememberTool(server as any);

    await server.call('remember_info', {text: 'hello', projectId: 'p'});

    expect(vi.mocked(getLocalEmbedding)).toHaveBeenCalledWith('hello');
  });

  it('returns isError when qdrant.upsert throws', async () => {
    vi.mocked(qdrant.upsert).mockRejectedValueOnce(new Error('DB unavailable'));
    const server = new MockServer();
    registerRememberTool(server as any);

    const result = await server.call('remember_info', {text: 'x', projectId: 'p'});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/DB unavailable/);
  });

  describe('profile enforcement', () => {
    it('rejects when a required tag is missing', async () => {
      const server = new MockServer();
      registerRememberTool(server as any, baseProfile);

      const result = await server.call('remember_info', {
        text: 'x',
        projectId: 'p',
        tags: ['service'], // missing 'type'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/Missing required tags: \[type\]/);
      expect(result.content[0]!.text).toMatch(/test-profile v1/);
      expect(vi.mocked(qdrant.upsert)).not.toHaveBeenCalled();
    });

    it('rejects when all required tags are missing', async () => {
      const server = new MockServer();
      registerRememberTool(server as any, baseProfile);

      const result = await server.call('remember_info', {
        text: 'x',
        projectId: 'p',
        tags: [],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/service/);
      expect(result.content[0]!.text).toMatch(/type/);
    });

    it('rejects an invalid category', async () => {
      const server = new MockServer();
      registerRememberTool(server as any, baseProfile);

      const result = await server.call('remember_info', {
        text: 'x',
        projectId: 'p',
        tags: ['service', 'type'],
        category: 'Misc',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/Invalid category 'Misc'/);
      expect(vi.mocked(qdrant.upsert)).not.toHaveBeenCalled();
    });

    it('accepts a valid category when profile is active', async () => {
      const server = new MockServer();
      registerRememberTool(server as any, baseProfile);

      const result = await server.call('remember_info', {
        text: 'x',
        projectId: 'p',
        tags: ['service', 'type'],
        category: 'Architecture Decisions',
      });

      expect(result.isError).toBeUndefined();
      expect(vi.mocked(qdrant.upsert)).toHaveBeenCalledOnce();
    });

    it('allows omitting category even when profile defines memory_categories', async () => {
      const server = new MockServer();
      registerRememberTool(server as any, baseProfile);

      const result = await server.call('remember_info', {
        text: 'x',
        projectId: 'p',
        tags: ['service', 'type'],
      });

      expect(result.isError).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// search_memories
// ---------------------------------------------------------------------------

describe('search_memories', () => {
  it('returns formatted results from qdrant', async () => {
    vi.mocked(qdrant.search).mockResolvedValueOnce([
      {id: 'abc-123', score: 0.9, payload: {projectId: 'proj', text: 'Auth uses RS256.'}},
    ] as any);

    const server = new MockServer();
    registerSearchTool(server as any);

    const result = await server.call('search_memories', {query: 'authentication', projectId: 'proj', limit: 5});

    expect(result.content[0]!.text).toMatch(/abc-123/);
    expect(result.content[0]!.text).toMatch(/Auth uses RS256/);
  });

  it('returns fallback message when no results found', async () => {
    vi.mocked(qdrant.search).mockResolvedValueOnce([]);
    const server = new MockServer();
    registerSearchTool(server as any);

    const result = await server.call('search_memories', {query: 'nothing', limit: 5});

    expect(result.content[0]!.text).toBe('No matching memories found.');
  });

  it('passes projectId filter when provided', async () => {
    vi.mocked(qdrant.search).mockResolvedValueOnce([]);
    const server = new MockServer();
    registerSearchTool(server as any);

    await server.call('search_memories', {query: 'q', projectId: 'my-project', limit: 5});

    const searchCall = vi.mocked(qdrant.search).mock.calls[0]!;
    expect(searchCall[1]).toMatchObject({
      filter: {must: [{key: 'projectId', match: {value: 'my-project'}}]},
    });
  });

  it('passes no filter when projectId is omitted', async () => {
    vi.mocked(qdrant.search).mockResolvedValueOnce([]);
    const server = new MockServer();
    registerSearchTool(server as any);

    await server.call('search_memories', {query: 'q', limit: 5});

    const searchCall = vi.mocked(qdrant.search).mock.calls[0]!;
    expect(searchCall[1]).not.toHaveProperty('filter');
  });

  it('embeds the query text', async () => {
    vi.mocked(qdrant.search).mockResolvedValueOnce([]);
    const server = new MockServer();
    registerSearchTool(server as any);

    await server.call('search_memories', {query: 'my query', limit: 5});

    expect(vi.mocked(getLocalEmbedding)).toHaveBeenCalledWith('my query');
  });
});

// ---------------------------------------------------------------------------
// forget_memory
// ---------------------------------------------------------------------------

describe('forget_memory', () => {
  it('deletes a single memory by memoryId', async () => {
    const server = new MockServer();
    registerForgetTool(server as any);

    const result = await server.call('forget_memory', {memoryId: 'abc-123'});

    expect(result.content[0]!.text).toMatch(/abc-123/);
    expect(vi.mocked(qdrant.delete)).toHaveBeenCalledWith('memories', {points: ['abc-123']});
  });

  it('deletes all memories for a project by projectId', async () => {
    const server = new MockServer();
    registerForgetTool(server as any);

    const result = await server.call('forget_memory', {projectId: 'my-project'});

    expect(result.content[0]!.text).toMatch(/my-project/);
    expect(vi.mocked(qdrant.delete)).toHaveBeenCalledWith('memories', {
      filter: {must: [{key: 'projectId', match: {value: 'my-project'}}]},
    });
  });

  it('returns isError when neither memoryId nor projectId is provided', async () => {
    const server = new MockServer();
    registerForgetTool(server as any);

    const result = await server.call('forget_memory', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/memoryId or a projectId/);
    expect(vi.mocked(qdrant.delete)).not.toHaveBeenCalled();
  });

  it('returns isError when qdrant.delete throws', async () => {
    vi.mocked(qdrant.delete).mockRejectedValueOnce(new Error('delete failed'));
    const server = new MockServer();
    registerForgetTool(server as any);

    const result = await server.call('forget_memory', {memoryId: 'abc'});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/delete failed/);
  });
});

// ---------------------------------------------------------------------------
// get_current_project_id
// ---------------------------------------------------------------------------

describe('get_current_project_id', () => {
  const originalEnv = process.env.PROJECT_ROOT;

  beforeEach(() => {
    delete process.env.PROJECT_ROOT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PROJECT_ROOT = originalEnv;
    } else {
      delete process.env.PROJECT_ROOT;
    }
  });

  it('returns the basename of PROJECT_ROOT when set', async () => {
    process.env.PROJECT_ROOT = '/home/user/workspace/my-project';
    const server = new MockServer();
    registerGetCurrent(server as any);

    const result = await server.call('get_current_project_id');

    expect(result.content[0]!.text).toBe('my-project');
  });

  it('falls back to the basename of cwd when PROJECT_ROOT is not set', async () => {
    const server = new MockServer();
    registerGetCurrent(server as any);

    const result = await server.call('get_current_project_id');

    const {basename} = await import('node:path');
    expect(result.content[0]!.text).toBe(basename(process.cwd()));
  });
});

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

describe('list_projects', () => {
  it('returns a deduplicated sorted project list', async () => {
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({
      points: [
        {id: '1', payload: {projectId: 'proj-b'}},
        {id: '2', payload: {projectId: 'proj-a'}},
        {id: '3', payload: {projectId: 'proj-b'}}, // duplicate
      ],
    } as any);

    const server = new MockServer();
    registerListProjectsTool(server as any);

    const result = await server.call('list_projects');

    expect(result.content[0]!.text).toMatch(/proj-a/);
    expect(result.content[0]!.text).toMatch(/proj-b/);
    // Should appear only once despite duplicate in data
    expect(result.content[0]!.text.split('proj-b').length - 1).toBe(1);
  });

  it('returns a fallback message when no projects exist', async () => {
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({points: []} as any);
    const server = new MockServer();
    registerListProjectsTool(server as any);

    const result = await server.call('list_projects');

    expect(result.content[0]!.text).toMatch(/No projects found/);
  });

  it('ignores points with missing or non-string projectId', async () => {
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({
      points: [
        {id: '1', payload: {projectId: 'valid-project'}},
        {id: '2', payload: {}},          // missing projectId
        {id: '3', payload: {projectId: 42}}, // non-string
      ],
    } as any);

    const server = new MockServer();
    registerListProjectsTool(server as any);

    const result = await server.call('list_projects');

    expect(result.content[0]!.text).toContain('valid-project');
    expect(result.content[0]!.text.match(/\n-/g)?.length).toBe(1);
  });

  it('returns isError when qdrant.scroll throws', async () => {
    vi.mocked(qdrant.scroll).mockRejectedValueOnce(new Error('scroll failed'));
    const server = new MockServer();
    registerListProjectsTool(server as any);

    const result = await server.call('list_projects');

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/scroll failed/);
  });
});
