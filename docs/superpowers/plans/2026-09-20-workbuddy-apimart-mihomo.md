# WorkBuddy APIMart + Mihomo Implementation Plan

> **For agentic workers:** Implement inline with TDD and verify each task before continuing.

**Goal:** Make APIMart the production image provider through an internal Mihomo sidecar while keeping GPT.Ge available for manual rollback.

**Architecture:** API and worker explicitly proxy only APIMart API and result-download traffic through Mihomo. Mihomo uses a subscription-backed fallback group; all other dependencies remain direct. Jobs retain their recorded provider so reconciliation survives later provider switches.

**Tech Stack:** Node.js 22, Fastify, PostgreSQL, Docker Compose, Mihomo, MetaCubeXD, Tencent COS, undici.

## Global Constraints

- Mihomo is pinned to `metacubex/mihomo:v1.19.31`; no TUN and no host-wide proxy.
- APIMart is primary, GPT.Ge is manual rollback only; never auto-resubmit across providers.
- Reference images remain limited to four.
- Resolution accepts `auto`, `1k`, `2k`, and `4k`; all successful images currently cost one credit.
- Secrets and signed URLs never enter Git or logs.

### Task 1: Contracts, configuration, and Mihomo runtime

- Add failing tests for 4K parsing, APIMart model/proxy config, secret-safe Mihomo config generation, and Compose isolation.
- Implement the configuration generator, pinned sidecars, internal ports, and environment examples.
- Verify targeted tests and `docker compose config --quiet`.

### Task 2: APIMart explicit proxy transport

- Add failing tests for explicit proxy dispatch, timeouts, request-field allowlisting, configurable Sunburst model, health check, and result download.
- Implement the proxy transport and APIMart client behavior.
- Verify gateway tests.

### Task 3: Reliable asynchronous generation

- Add failing tests for signed reference URLs, pre-submit defer without POST, provider registry reconciliation, and proxied output persistence.
- Implement job deferral, provider registry, reference URL flow, and provider-specific result download.
- Verify platform generation and reconciliation tests.

### Task 4: Admission, monitoring, documentation, and full verification

- Add failing tests for cached generation admission and safe metrics.
- Implement provider availability reporting and deployment/runbook documentation.
- Run `npm test`, `npm run web:build`, `docker compose config --quiet`, and `git diff --check`.
