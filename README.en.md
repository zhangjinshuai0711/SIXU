<div align="center">

<img src="branding/sixu-hero.svg" alt="SIXU · Stop guessing. Start reasoning." width="100%" />

**⚡ ChatGPT Instant × SIXU — an external reasoning workflow for the shared-allowance era.**

### **Starting December 2026: ChatGPT and Codex share usage allowances; Instant chat does not draw from that allowance.**

**Give Instant a structured route beyond one-shot answers.** Explore candidates, review constraints and record revisions with Sixu—while reserving eligible higher-effort usage for tasks that truly need it.

[**Instant + Sixu setup**](#use-sixu-with-chatgpt-instant) · [**Why December matters**](#why-instant--sixu-now) · [**See the flowchart**](#how-sixu-guides-instant)

[![Version](https://img.shields.io/badge/version-v0.4.0-715DF2)](CHANGELOG.md)
[![Protocol](https://img.shields.io/badge/MCP-workflow-2B4375)](docs/V0.4.md)
[![Hosting](https://img.shields.io/badge/deployment-self--hosted-2B8F88)](cloud/README.md)

**[Quick start](#quick-start)** · **[Real example](#real-world-comparison-instant-vs-sixu)** · **[Documentation](docs/INSTALL.md)** · **[中文说明](README.md)**

</div>

---

## What is Sixu?

**SIXU (思序)** is an MCP-based reasoning workflow orchestrator for chat clients that support custom MCP integrations.

Your **existing chat model** proposes and reviews candidates. Sixu manages stage transitions, state, versioned revisions, and limited programmatic checks over explicitly declared, supported requirements.

It is **not another model**, does not increase the model's internal thinking budget, and does not invoke a separate paid model API.

## Why Instant + Sixu now?

According to [OpenAI's official usage-limits announcement](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits), **starting in December 2026, ChatGPT and Codex share a token-measured allowance for Plus, Pro and Business plans, while Instant chat does not draw from this shared allowance.**

| Native higher-effort modes / Codex | **ChatGPT Instant + Sixu** |
| --- | --- |
| Use the applicable shared allowance | **Instant chat is excluded from that shared allowance** |
| Can use a higher native thinking effort | **Remains the selected Instant model** |
| Good for harder model-intensive tasks | Uses bounded external candidate exploration and limited checks for suitable tasks |
| Depends on the selected model/feature | Requires custom MCP access; Sixu itself calls no extra paid model API |

**Practical positioning:** try Instant + Sixu for checkable, constraint-heavy work, then use native higher-effort modes or Codex when required.

> **Important:** “Instant chat does not draw from the shared allowance” is **not** a promise of unlimited Instant messages or unlimited MCP/tool calls. Client capabilities, account permissions, other restrictions and applicable usage rules still apply. Sixu cannot unlock the model's native High thinking budget, and general accuracy gains are not yet established. Check **Settings → Usage**. [Official source](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits) (reviewed November 10, 2026).

## How Sixu guides Instant

<div align="center">

<img src="branding/sixu-instant-flow.gif" alt="Animated ChatGPT Instant and Sixu workflow: INPUT, EXPAND, BRANCH, CHALLENGE, VERIFY, REVISE, FINALIZE, including an optional revision loop" width="100%" />

<sub>Animated conceptual diagram · Actual stages depend on the task and server next_action; only declared, supported conditions can be programmatically checked.</sub>

</div>

**The current chat model generates candidates; Sixu MCP maintains state, protocol gates, candidate versions and bounded programmatic checks.** Deep workflow mode requires candidate comparison. Revisions invalidate stale reviews, and protocol completion is not proof of universal correctness.

[v0.4.0 protocol and checks](docs/V0.4.md) · [Usage guide](docs/USAGE.md)

## Real-world comparison: Instant vs Sixu

**November 10, 2026 · Same five-project constrained selection task · Two actual ChatGPT conversations**

<div align="center">

<img src="docs/images/instant-vs-sixu-demo-hd.png" alt="High-resolution visual comparison based on two public chats: Instant and Instant plus Sixu Deep both select A, D, E, cost 10, value 25; Sixu reports model_review_only and zero executed internal checks." width="100%" />

<sub>High-resolution PNG illustration (1536×1024) composed from details shown in the real chat screenshots—not a literal screenshot montage. Consult the linked conversations for the original evidence; this is not a controlled benchmark.</sub>

</div>

| Observation | **Instant alone** | **Instant + Sixu Deep** |
| --- | --- | --- |
| Final selection | **A + D + E** | **A + D + E** |
| Cost / value | **10 / 25** | **10 / 25** |
| What happened | Initially proposed an invalid `B + D + E`, then **self-corrected within the same reply** | Compared candidates and recorded workflow state |
| Workflow | No Sixu | `completed` / `deep` / 3 steps |
| Sixu program checks | Not applicable | **0 executed** · `model_review_only` |

**Task:** A(cost 4, value 9), B(3,8), C(5,12), D(2,6), E(4,10); budget ≤ 10; selecting C requires A; B and E are mutually exclusive. Independent exhaustive enumeration of 32 subsets gives 13 feasible subsets and confirms **A + D + E** as the unique optimum (value 25). **That enumeration was not an internal check performed by Sixu during this run.**

**What this demonstrates:** Both final answers were correct. Sixu exposed a stateful candidate-review workflow; the direct Instant answer also caught its own constraint mistake. **One example does not establish an accuracy improvement.** A model claiming exhaustive verification is not equivalent to an executed server check.

**Source conversations:** [Chat ①](https://chatgpt.com/share/6af2f8a7-204c-83ee-90e7-ec4f938d98f6) · [Chat ②](https://chatgpt.com/share/6af2f8d9-bf64-83ee-95bd-148e626523ea) · [Evidence and limits](docs/EVALUATION.md)

## A concrete example

<img src="branding/sixu-revision-story.svg" alt="Illustrative arithmetic example: an incorrect 497 candidate is revised to 507 and checked" width="100%" />

Consider the task `18 × 24 + 75`. An initial candidate `497` is incorrect. If the client declares the corresponding structured arithmetic check, the service can reject the candidate and track a revised value of `507` with a new candidate version.

**This is a conceptual illustration, not a recording or benchmark result.** Checks only cover supported conditions actually submitted to the service.

## Use Sixu with ChatGPT Instant

In a ChatGPT client where custom MCP apps are available: **select Instant** → select your connected **Sixu** app → send a task with an explicit app mention → confirm the actual tool-returned `run_id`.

```text
@思序 深度：Use the current Instant model. Compare candidates, review the task constraints, revise if necessary, then report the actual run_id and verification status.
```

"Deep" is Sixu's **external workflow depth**, not ChatGPT's native High thinking mode. If the app is unavailable in Instant on your account, do not infer that the service executed.

## Quick start

**Requirements:** Git, Node.js 22+, npm and Cloudflare [`cloudflared`](https://developers.cloudflare.com/tunnel/downloads/). The local installation workflow has been tested on macOS.

```bash
git clone https://github.com/zhangjinshuai0711/SIXU.git
cd SIXU
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

[Local installation](docs/INSTALL.md) · [Cloud deployment](cloud/README.md) · [Usage](docs/USAGE.md) · [v0.4 protocol](docs/V0.4.md) · [Brand guide](branding/README.md)

<div align="center">

**STOP GUESSING. START REASONING.**

<sub>v0.4.0 · Source available · Self-hosted · No license has been specified for this repository yet.</sub>

</div>
