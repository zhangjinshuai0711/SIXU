<div align="center">

<img src="branding/sixu-hero.svg" alt="SIXU · Stop guessing. Start reasoning." width="100%" />

**Trace the reasoning. Track the revisions.**

Give your current chat model a bounded, stateful workflow for exploring candidates, reviewing constraints and revising results.

[![Version](https://img.shields.io/badge/version-v0.4.0-715DF2)](CHANGELOG.md)
[![Protocol](https://img.shields.io/badge/MCP-workflow-2B4375)](docs/V0.4.md)
[![Hosting](https://img.shields.io/badge/deployment-self--hosted-2B8F88)](cloud/README.md)

**[Quick start](#quick-start)** · **[See the example](#a-concrete-example)** · **[Documentation](docs/INSTALL.md)** · **[中文说明](README.md)**

</div>

---

## What is Sixu?

**SIXU (思序)** is an MCP-based reasoning workflow orchestrator for chat clients that support custom MCP integrations.

Your **existing chat model** proposes and reviews candidates. Sixu manages stage transitions, state, versioned revisions, and limited programmatic checks over explicitly declared, supported requirements.

It is **not another model**, does not increase the model's internal thinking budget, and does not invoke a separate paid model API.

## A concrete example

<img src="branding/sixu-revision-story.svg" alt="Illustrative arithmetic example: an incorrect 497 candidate is revised to 507 and checked" width="100%" />

Consider the task `18 × 24 + 75`. An initial candidate `497` is incorrect. If the client declares the corresponding structured arithmetic check, the service can reject the candidate and track a revised value of `507` with a new candidate version.

**This is a conceptual illustration, not a recording or benchmark result.** Checks only cover supported conditions actually submitted to the service. [Real-demo recording checklist](docs/RECORD_DEMO.md).

## Quick start

**Requirements:** Git, Node.js 22+, npm and Cloudflare [`cloudflared`](https://developers.cloudflare.com/tunnel/downloads/). The local installation workflow has been tested on macOS.

```bash
git clone https://github.com/zhangjinshuai0711/reasoning-harness-mcp.git
cd reasoning-harness-mcp
npm ci
npm test
npm start
```

Use the **`mcp_url` printed by your own service** when setting up a custom MCP application in ChatGPT, if the account and client offer that capability. Never publish the full connection URL: its random path acts as a credential. The local Quick Tunnel is for non-sensitive testing, not a production-grade public service.

Prefer a persistent, private deployment? Follow the [cloud deployment guide](cloud/README.md). **The repository contains publicly readable source, not a public hosted MCP service.** Existing author deployments are private.

### Try it in chat

```text
@思序 中度：Compare two implementations, identify constraints and recommend one.
```

```text
@思序 深度：Create and compare candidates for this scheduling problem. Check constraints before finalizing.
```

Select the app when you want it to run, and verify actual tool calls and the returned `run_id`. "Deep" means a larger **external workflow budget**, not ChatGPT's native High thinking mode.

## Why Sixu?

| Feature | What it adds |
| --- | --- |
| **Candidate comparison** | Deep mode requires an actual comparison between at least two candidates. |
| **Version-aware revision** | Revising a candidate invalidates reviews tied to its previous version. |
| **Bounded checks** | The service can execute declared arithmetic, schema and selected scheduling/selection checks. |
| **Persistent state** | Recover relevant candidate and stage records by `run_id` within the supported lifetime. |

Useful for constrained planning, option comparisons, checkable calculations, edge-case analysis, and tasks where recorded revisions matter.

## What Sixu does *not* promise

- No second model or paid model API is called by the Sixu service. The host chat may still consume usage allowances and time.
- `completed` means **the protocol completed**, not that every claim was independently proven.
- A passed program check covers only the supported, **declared** condition; it is not necessarily proof of global optimality.
- Current small-scale experiments do **not** establish a universal accuracy improvement over direct prompting, stronger prompts, or native higher-effort modes.

See [evaluation evidence](docs/EVALUATION.md), [18 first-response results](docs/PILOT-18-RESULTS.md), the [six-task comparison](benchmarks/pilot-v02/README.md), and the [v0.4 release notes](docs/releases/v0.4.0.md).

## Documentation

[Local installation](docs/INSTALL.md) · [Cloud deployment](cloud/README.md) · [Usage](docs/USAGE.md) · [v0.4 protocol](docs/V0.4.md) · [Brand guide](branding/README.md) · [Recording guide](docs/RECORD_DEMO.md)

<div align="center">

**STOP GUESSING. START REASONING.**

<sub>v0.4.0 · Source available · Self-hosted · No license has been specified for this repository yet.</sub>

</div>
