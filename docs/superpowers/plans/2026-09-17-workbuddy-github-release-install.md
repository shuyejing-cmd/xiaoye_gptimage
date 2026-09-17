# WorkBuddy GitHub Release Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the four-step WorkBuddy installation flow through a public GitHub Release, a 30-minute one-time installation token, safe legacy migration, and a release-aware website.

**Architecture:** The commercial API remains on xiaoyeai.cn while immutable versioned bridge installation assets are published through GitHub Releases. A cached server-side release verifier gates prompt issuance, and the local installer atomically replaces a recognized legacy image-bridge only after the new xiaoye-image candidate passes verification.

**Tech Stack:** Node.js 22, Fastify, React/Vite, Inno Setup, PowerShell, GitHub Actions, node:test

---

### Task 1: Version and token contract

- [ ] Add failing tests for a 30-minute installation-token lifetime and synchronized 1.2.0 artifacts.
- [ ] Implement the lifetime and version changes.
- [ ] Run focused tests and commit.

### Task 2: GitHub Release verification

- [ ] Add failing tests for repository validation, release URLs, manifest parsing, asset size, SHA-256 verification, five-minute caching, and single-flight checks.
- [ ] Implement the release verifier and `GET /api/install-release/status`.
- [ ] Gate installation-token issuance when the release is unavailable.
- [ ] Run focused tests and commit.

### Task 3: Installation prompt hardening

- [ ] Add failing tests for GitHub URLs, non-empty bootstrap checks, explicit PowerShell invocation, exact `installed` success, and unconditional cleanup.
- [ ] Implement the hardened prompt without exposing long-lived Keys.
- [ ] Run focused tests and commit.

### Task 4: Legacy image-bridge migration

- [ ] Add failing tests for exact legacy fingerprints, successful removal, unknown-entry preservation, and rollback.
- [ ] Implement preflight verification and atomic final configuration.
- [ ] Run installer tests and commit.

### Task 5: Unsigned beta release pipeline

- [ ] Add failing release-contract tests for three complete non-empty assets and all-or-nothing publication.
- [ ] Update the 1.2.0 unsigned beta build and manifest flow.
- [ ] Add a `v*` GitHub Actions release workflow using Node 22 and Inno Setup.
- [ ] Run release tests and commit.

### Task 6: Release-aware website

- [ ] Add failing web-state tests.
- [ ] Show release readiness, a 30-minute one-use notice, GitHub beta warning, and the manual installer URL.
- [ ] Disable prompt issuance while the release is unavailable.
- [ ] Build and visually verify desktop/mobile states, then commit.

### Task 7: Verification and handoff

- [ ] Run `npm test`, `npm run web:build`, and `git diff --check`.
- [ ] Update docs and production checklist for GitHub distribution and the two remaining manual tasks.
- [ ] Record the public repository and clean-Windows validation as explicit incomplete gates.
- [ ] Commit the completed implementation plan and preserve the feature branch.
