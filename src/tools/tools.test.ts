import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// vi.mock is hoisted — these run before any imports below
vi.mock('../lib/qdrant.js', () => ({
  qdrant: {
    upsert: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({}),
    scroll: vi.fn().mockResolvedValue({points: []}),
    retrieve: vi.fn().mockResolvedValue([]),
  },
  sharedQdrant: null,
  ensureCollection: vi.fn().mockResolvedValue(undefined),
  ensureSharedCollection: vi.fn().mockResolvedValue(undefined),
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
import {registerPromoteTool} from './promote.js';
import type {MemoryProfile} from '../lib/profile.js';

// ---------------------------------------------------------------------------
// Reusable mock shared Qdrant client
// ---------------------------------------------------------------------------

function makeMockSharedQdrant() {
  return {
    upsert: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({}),
    scroll: vi.fn().mockResolvedValue({points: []}),
    retrieve: vi.fn().mockResolvedValue([]),
  };
}

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

// ---------------------------------------------------------------------------
// promote_memory
// ---------------------------------------------------------------------------

describe('promote_memory', () => {
  it('returns isError when shared layer is not configured', async () => {
    const server = new MockServer();
    registerPromoteTool(server as any, null);

    const result = await server.call('promote_memory', {memoryId: 'abc-123'});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/QDRANT_SHARED_URL/);
    expect(vi.mocked(qdrant.retrieve)).not.toHaveBeenCalled();
  });

  it('returns isError when memory not found in personal layer', async () => {
    vi.mocked(qdrant.retrieve).mockResolvedValueOnce([]);
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerPromoteTool(server as any, mockShared as any);

    const result = await server.call('promote_memory', {memoryId: 'abc-123'});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found in personal layer/);
    expect(mockShared.upsert).not.toHaveBeenCalled();
  });

  it('copies memory to shared layer with a new UUID', async () => {
    const personalId = 'personal-uuid-123';
    vi.mocked(qdrant.retrieve).mockResolvedValueOnce([{
      id: personalId,
      vector: new Array(384).fill(0.1),
      payload: {text: 'Auth uses RS256', projectId: 'my-project', tags: ['auth'], scope: 'personal'},
    }] as any);
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerPromoteTool(server as any, mockShared as any);

    const result = await server.call('promote_memory', {memoryId: personalId});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toMatch(/promoted to shared layer/);
    expect(result.content[0]!.text).toMatch(/my-project/);

    const upsertCall = mockShared.upsert.mock.calls[0]!;
    const point = (upsertCall[1] as any).points[0];
    // Must use a NEW UUID — not the personal ID
    expect(point.id).not.toBe(personalId);
    expect(point.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets scope to "shared" in the promoted payload', async () => {
    vi.mocked(qdrant.retrieve).mockResolvedValueOnce([{
      id: 'abc-123',
      vector: new Array(384).fill(0.1),
      payload: {text: 'x', projectId: 'p', scope: 'personal'},
    }] as any);
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerPromoteTool(server as any, mockShared as any);

    await server.call('promote_memory', {memoryId: 'abc-123'});

    const point = (mockShared.upsert.mock.calls[0]![1] as any).points[0];
    expect(point.payload.scope).toBe('shared');
  });

  it('does not delete the personal copy after promotion', async () => {
    vi.mocked(qdrant.retrieve).mockResolvedValueOnce([{
      id: 'abc-123',
      vector: new Array(384).fill(0.1),
      payload: {text: 'x', projectId: 'p'},
    }] as any);
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerPromoteTool(server as any, mockShared as any);

    await server.call('promote_memory', {memoryId: 'abc-123'});

    expect(vi.mocked(qdrant.delete)).not.toHaveBeenCalled();
  });

  it('returns isError when shared upsert throws', async () => {
    vi.mocked(qdrant.retrieve).mockResolvedValueOnce([{
      id: 'abc-123',
      vector: new Array(384).fill(0.1),
      payload: {text: 'x', projectId: 'p'},
    }] as any);
    const mockShared = makeMockSharedQdrant();
    mockShared.upsert.mockRejectedValueOnce(new Error('shared write failed'));
    const server = new MockServer();
    registerPromoteTool(server as any, mockShared as any);

    const result = await server.call('promote_memory', {memoryId: 'abc-123'});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/shared write failed/);
  });
});

// ---------------------------------------------------------------------------
// search_memories — shared layer behaviour
// ---------------------------------------------------------------------------

describe('search_memories (shared layer)', () => {
  it('queries both layers when sharedQdrant is provided', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.search).mockResolvedValueOnce([]);
    const server = new MockServer();
    registerSearchTool(server as any, mockShared as any);

    await server.call('search_memories', {query: 'q', limit: 5});

    expect(vi.mocked(qdrant.search)).toHaveBeenCalledOnce();
    expect(mockShared.search).toHaveBeenCalledOnce();
  });

  it('merges and sorts results by score descending with source labels', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.search).mockResolvedValueOnce([
      {id: 'p1', score: 0.9, payload: {projectId: 'proj', text: 'Personal high'}},
      {id: 'p2', score: 0.5, payload: {projectId: 'proj', text: 'Personal low'}},
    ] as any);
    mockShared.search.mockResolvedValueOnce([
      {id: 's1', score: 0.85, payload: {projectId: 'proj', text: 'Shared mid'}},
    ] as any);

    const server = new MockServer();
    registerSearchTool(server as any, mockShared as any);

    const result = await server.call('search_memories', {query: 'q', limit: 5});
    const text = result.content[0]!.text;

    // Correct order: p1(0.9), s1(0.85), p2(0.5)
    const p1Pos = text.indexOf('Personal high');
    const s1Pos = text.indexOf('Shared mid');
    const p2Pos = text.indexOf('Personal low');
    expect(p1Pos).toBeLessThan(s1Pos);
    expect(s1Pos).toBeLessThan(p2Pos);

    // Labels present
    expect(text).toMatch(/\[personal\]/);
    expect(text).toMatch(/\[shared\]/);
  });

  it('applies limit to merged results, not per layer', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.search).mockResolvedValueOnce([
      {id: 'p1', score: 0.9, payload: {projectId: 'proj', text: 'top-personal'}},
      {id: 'p2', score: 0.8, payload: {projectId: 'proj', text: 'low-personal'}},
    ] as any);
    mockShared.search.mockResolvedValueOnce([
      {id: 's1', score: 0.85, payload: {projectId: 'proj', text: 'top-shared'}},
      {id: 's2', score: 0.7, payload: {projectId: 'proj', text: 'low-shared'}},
    ] as any);

    const server = new MockServer();
    registerSearchTool(server as any, mockShared as any);

    const result = await server.call('search_memories', {query: 'q', limit: 2});
    const text = result.content[0]!.text;

    // Only top 2 results: p1(0.9) and s1(0.85)
    expect(text).toContain('top-personal');
    expect(text).toContain('top-shared');
    expect(text).not.toContain('low-personal');
    expect(text).not.toContain('low-shared');
  });

  it('falls back to personal results when shared layer throws', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.search).mockResolvedValueOnce([
      {id: 'p1', score: 0.9, payload: {projectId: 'proj', text: 'Personal result'}},
    ] as any);
    mockShared.search.mockRejectedValueOnce(new Error('shared down'));

    const server = new MockServer();
    registerSearchTool(server as any, mockShared as any);

    const result = await server.call('search_memories', {query: 'q', limit: 5});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Personal result');
  });

  it('omits source labels when no shared layer is configured', async () => {
    vi.mocked(qdrant.search).mockResolvedValueOnce([
      {id: 'p1', score: 0.9, payload: {projectId: 'proj', text: 'Only personal'}},
    ] as any);
    const server = new MockServer();
    registerSearchTool(server as any); // no sharedQdrant

    const result = await server.call('search_memories', {query: 'q', limit: 5});

    expect(result.content[0]!.text).not.toMatch(/\[personal\]/);
    expect(result.content[0]!.text).not.toMatch(/\[shared\]/);
  });
});

// ---------------------------------------------------------------------------
// forget_memory — scope parameter
// ---------------------------------------------------------------------------

describe('forget_memory (scope)', () => {
  it('deletes from personal only when scope is "personal" (default)', async () => {
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerForgetTool(server as any, mockShared as any);

    await server.call('forget_memory', {memoryId: 'abc', scope: 'personal'});

    expect(vi.mocked(qdrant.delete)).toHaveBeenCalledOnce();
    expect(mockShared.delete).not.toHaveBeenCalled();
  });

  it('deletes from shared only when scope is "shared"', async () => {
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerForgetTool(server as any, mockShared as any);

    const result = await server.call('forget_memory', {memoryId: 'abc', scope: 'shared'});

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(qdrant.delete)).not.toHaveBeenCalled();
    expect(mockShared.delete).toHaveBeenCalledOnce();
  });

  it('deletes from both layers when scope is "all"', async () => {
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerForgetTool(server as any, mockShared as any);

    const result = await server.call('forget_memory', {memoryId: 'abc', scope: 'all'});

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(qdrant.delete)).toHaveBeenCalledOnce();
    expect(mockShared.delete).toHaveBeenCalledOnce();
    expect(result.content[0]!.text).toMatch(/both layers/);
  });

  it('returns isError for scope "shared" when shared layer not configured', async () => {
    const server = new MockServer();
    registerForgetTool(server as any, null);

    const result = await server.call('forget_memory', {memoryId: 'abc', scope: 'shared'});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/QDRANT_SHARED_URL/);
  });

  it('partial success message when scope "all" and shared delete fails', async () => {
    const mockShared = makeMockSharedQdrant();
    mockShared.delete.mockRejectedValueOnce(new Error('shared unavailable'));
    const server = new MockServer();
    registerForgetTool(server as any, mockShared as any);

    const result = await server.call('forget_memory', {memoryId: 'abc', scope: 'all'});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toMatch(/personal layer/);
    expect(result.content[0]!.text).toMatch(/shared unavailable/);
  });
});

// ---------------------------------------------------------------------------
// remember_info — scope in payload and auto-promote
// ---------------------------------------------------------------------------

describe('remember_info (scope & auto-promote)', () => {
  it('stores scope "personal" in the Qdrant payload', async () => {
    const server = new MockServer();
    registerRememberTool(server as any);

    await server.call('remember_info', {text: 'x', projectId: 'p'});

    const payload = (vi.mocked(qdrant.upsert).mock.calls[0]![1] as any).points[0].payload;
    expect(payload.scope).toBe('personal');
  });

  it('auto-promotes when tag matches auto_promote_tags and shared layer is configured', async () => {
    const profile: MemoryProfile = {
      version: 1, name: 'test', required_tags: [], memory_categories: [],
      auto_promote_tags: ['architecture'],
    };
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerRememberTool(server as any, profile, mockShared as any);

    const result = await server.call('remember_info', {
      text: 'We use event sourcing', projectId: 'p', tags: ['architecture', 'backend'],
    });

    expect(vi.mocked(qdrant.upsert)).toHaveBeenCalledOnce();   // personal write
    expect(mockShared.upsert).toHaveBeenCalledOnce();          // auto-promote
    expect(result.content[0]!.text).toMatch(/auto-promoted to shared/);
    expect(result.content[0]!.text).toMatch(/architecture/);

    const sharedPayload = (mockShared.upsert.mock.calls[0]![1] as any).points[0].payload;
    expect(sharedPayload.scope).toBe('shared');
  });

  it('does not auto-promote when no tags match auto_promote_tags', async () => {
    const profile: MemoryProfile = {
      version: 1, name: 'test', required_tags: [], memory_categories: [],
      auto_promote_tags: ['architecture'],
    };
    const mockShared = makeMockSharedQdrant();
    const server = new MockServer();
    registerRememberTool(server as any, profile, mockShared as any);

    await server.call('remember_info', {text: 'x', projectId: 'p', tags: ['payments']});

    expect(mockShared.upsert).not.toHaveBeenCalled();
  });

  it('succeeds with personal-only write when shared layer not configured but tag matches', async () => {
    const profile: MemoryProfile = {
      version: 1, name: 'test', required_tags: [], memory_categories: [],
      auto_promote_tags: ['architecture'],
    };
    const server = new MockServer();
    registerRememberTool(server as any, profile, null); // no shared

    const result = await server.call('remember_info', {
      text: 'x', projectId: 'p', tags: ['architecture'],
    });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(qdrant.upsert)).toHaveBeenCalledOnce();
  });

  it('still succeeds with personal write when auto-promote fails', async () => {
    const profile: MemoryProfile = {
      version: 1, name: 'test', required_tags: [], memory_categories: [],
      auto_promote_tags: ['architecture'],
    };
    const mockShared = makeMockSharedQdrant();
    mockShared.upsert.mockRejectedValueOnce(new Error('shared down'));
    const server = new MockServer();
    registerRememberTool(server as any, profile, mockShared as any);

    const result = await server.call('remember_info', {
      text: 'x', projectId: 'p', tags: ['architecture'],
    });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(qdrant.upsert)).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// list_projects — shared layer
// ---------------------------------------------------------------------------

describe('list_projects (shared layer)', () => {
  it('merges projects from both layers and deduplicates', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({
      points: [{id: '1', payload: {projectId: 'personal-only'}}],
    } as any);
    mockShared.scroll.mockResolvedValueOnce({
      points: [
        {id: '2', payload: {projectId: 'shared-only'}},
        {id: '3', payload: {projectId: 'personal-only'}}, // duplicate
      ],
    } as any);

    const server = new MockServer();
    registerListProjectsTool(server as any, mockShared as any);

    const result = await server.call('list_projects');
    const text = result.content[0]!.text;

    expect(text).toContain('personal-only');
    expect(text).toContain('shared-only');
    // Should appear only once
    expect(text.split('personal-only').length - 1).toBe(1);
  });

  it('returns projects from shared even when personal has none', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({points: []} as any);
    mockShared.scroll.mockResolvedValueOnce({
      points: [{id: '1', payload: {projectId: 'team-project'}}],
    } as any);

    const server = new MockServer();
    registerListProjectsTool(server as any, mockShared as any);

    const result = await server.call('list_projects');
    expect(result.content[0]!.text).toContain('team-project');
  });

  it('degrades gracefully when shared layer is unreachable', async () => {
    const mockShared = makeMockSharedQdrant();
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({
      points: [{id: '1', payload: {projectId: 'personal-only'}}],
    } as any);
    mockShared.scroll.mockRejectedValueOnce(new Error('shared down'));

    const server = new MockServer();
    registerListProjectsTool(server as any, mockShared as any);

    const result = await server.call('list_projects');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('personal-only');
  });
});
