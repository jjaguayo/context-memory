# context-memory: Product Ideas for Engineering Teams

> **Status:** Exploring  
> **Target:** Mid-size engineering teams (6–25)  
> **Model:** Open source, self-hosted or local infra  
> **Memory sharing:** Hybrid — personal + shared layers, projects opt into team standards

---

## Idea 1: Team Memory Profiles ("Memory Standards")

### Problem
Mid-size teams suffer from inconsistent AI context — one dev's Claude knows the architecture, another's doesn't. There's no shared convention for *what* to remember, *how* to tag it, or *how long* to keep it.

### Solution
A **Memory Profile** is a versioned, shareable configuration that defines the team standard for memory: tagging conventions, retention rules, required memory categories (e.g. architecture decisions, API contracts, gotchas). Teams define the standard once; projects opt in by referencing it.

### How It Works (Engineering)
- A `.context-memory/profile.yml` file in the repo (or org-level config) is read by the MCP server on startup
- The profile drives: auto-tagging rules, required fields on `remember_info`, scoping policy, and decay settings
- Existing projects without a profile file fall back to current behavior — **no breaking changes**
- New projects inherit the team standard automatically
- The profile can be committed to the repo (project-specific) or stored centrally (org-wide)

### Why It Matters for Open Source
It's the missing coordination layer that turns a personal tool into a team tool. No new infrastructure required — just a config file. Great first contribution surface for the community.

### Example `profile.yml`
```yaml
version: 1
name: "acme-eng-standard"
required_tags:
  - service      # which service this memory relates to
  - type         # architecture | decision | bug-fix | gotcha | preference
memory_categories:
  - Architecture Decisions
  - API Contracts
  - Known Gotchas
  - Coding Preferences
retention:
  default_days: 90
  architecture_days: 365
auto_promote_tags:
  - architecture
  - api-contract
```

---

## Idea 2: Shared Memory Layer with Personal Override

### Problem
Knowledge lives in one person's head (or session) and never reaches teammates. There's no way to intentionally share a memory with the rest of the team without manual copy-paste.

### Solution
A **two-tier memory model**: a **shared layer** (team-visible, deployed on team infra) and a **personal layer** (local, private). Search queries hit both layers. Promoting a personal memory to shared is a deliberate, lightweight action — like a git push for knowledge.

### How It Works (Engineering)
- Extend the existing `scope` concept on every memory: `personal` (default) | `shared`
- The MCP server resolves which Qdrant instance to query based on config:
  - `QDRANT_URL` (local) → personal memories
  - `QDRANT_SHARED_URL` (remote, team-deployed) → shared memories
- `remember_info` defaults to `scope: personal`
- New `promote_memory` tool pushes a personal memory to the shared instance
- Local-only contributors never configure `QDRANT_SHARED_URL` — the tool degrades gracefully
- Teams deploy the shared Qdrant instance on their own infra via existing Docker Compose, with one new env var

### New MCP Tool: `promote_memory`
```
promote_memory({ memoryId: "abc-123" })
→ "Memory promoted to shared layer for project my-project"
```

### Why It Matters for Open Source
Immediately useful solo, meaningfully better in teams. The infra model respects self-hosted and local-first constraints. The shared layer is purely opt-in — teams deploy it only when ready.

### Deployment Model
| User Type | Setup | Behavior |
|---|---|---|
| Solo contributor | Local Qdrant only | Personal memories, full functionality |
| Team member | Local + shared remote | Personal + shared search, can promote |
| New team member | Connect to shared remote | Instantly inherits team knowledge |

---

## Idea 3: Memory Provenance & Audit Trail

### Problem
Teams won't trust shared AI memory unless they know *where it came from*. "Who stored this? When? In what context? Is it still valid?" Without answers, shared memories become stale noise fast.

### Solution
**Provenance metadata** on every memory, plus a `memory_health` tool that surfaces stale or low-confidence memories for review. This turns context-memory into a credible team knowledge base — not just a cache.

### How It Works (Engineering)
Extend the Qdrant payload schema with:

```
author        : string        — git user or env-injected identity ($GIT_AUTHOR_NAME or $USER)
source_file   : string?       — file open when memory was stored (optional, agent-provided)
session_id    : string        — MCP session identifier
confidence    : float         — starts at 1.0, decays over time per profile policy
last_confirmed: ISO 8601      — when the memory was last validated/re-saved
```

Add a **`memory_health` MCP tool** that surfaces stale or low-confidence memories:
```
memory_health({ projectId: "my-project", scope: "shared" })
→ [STALE - 127 days] abc-123: "We use PostgreSQL for the payments service" (author: jsmith)
→ [STALE - 89 days]  def-456: "Auth service uses RS256 JWT tokens" (author: mjones)
```

Decay policy is configurable per memory category in `profile.yml`. The `CLAUDE.md` pattern already in the repo is a natural place to add instructions for when agents should call `memory_health`.

### Why It Matters for Open Source
Differentiates context-memory from a generic vector store. Provenance is table-stakes for team adoption. It's also a rich contributor surface: decay models, attribution UI, confirmation workflows, health dashboards.

---

## How These Ideas Fit Together

These three ideas form a natural implementation sequence:

| Phase | Idea | Value Unlocked | Effort |
|---|---|---|---|
| **Foundation** | Memory Profiles | Shared conventions, no infra needed | Low |
| **Growth** | Shared + Personal Layers | Team knowledge flows freely | Medium |
| **Trust** | Provenance & Audit Trail | Adoption at scale, enterprise-ready | Medium |

Each idea is independently valuable and shippable. Start with Profiles (pure config), layer in the Shared Layer (infra extension), then add Provenance (schema + tooling).

---

## Open Questions for Roadmap
- Should `profile.yml` live in the repo or be managed centrally (e.g. a shared git submodule)?
- What's the right UX for `promote_memory` — explicit tool call, or a flag on `remember_info`?
- Should `memory_health` run automatically at session start, or only on demand?
- How should conflicts be handled when two team members store contradicting memories?
