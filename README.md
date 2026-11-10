<div align="center">

<img src="branding/sixu-hero.svg" alt="SIXU 思序 · Stop guessing. Start reasoning. 带状态的推理工作流" width="100%" />

**让答案有路径，让修订有证据。**

把一次性回答变成可追踪的候选探索、检查与修订流程。

[![Version](https://img.shields.io/badge/version-v0.4.0-715DF2)](CHANGELOG.md)
[![Protocol](https://img.shields.io/badge/MCP-workflow-2B4375)](docs/V0.4.md)
[![Hosting](https://img.shields.io/badge/deployment-self--hosted-2B8F88)](cloud/README.md)
[![API](https://img.shields.io/badge/extra%20model%20API%20key-not%20required-8D5CD6)](#无需额外模型-api-key)

**[快速开始](#快速开始)** · **[先看示例](#一个具体例子)** · **[安装教程](docs/INSTALL.md)** · **[English](README.en.md)**

</div>

---

## 一句话理解思序

**SIXU（思序）是一个面向支持自定义 MCP 工具的聊天客户端的推理工作流编排器。** 当前聊天模型负责生成候选和审查内容；思序服务负责阶段调度、候选版本、任务状态，以及已声明且受支持的程序检查。

它**不是新的大模型**，也不会调整 ChatGPT 的原生推理档位。它的作用，是让复杂任务的处理过程更有结构、可以复查。

## 一个具体例子

<div align="center">
<img src="branding/sixu-revision-story.svg" alt="教学示意：18 乘 24 加 75，候选错误值 497 在声明的算术检查中失败，经修订后得到 507" width="100%" />
</div>

**假设**某个任务的候选结果是 `497`，而题目要求计算 `18 × 24 + 75`。当客户端确实提交了对应的结构化检查，服务可标记检查失败；模型随后修订候选为 `507`，再接受针对新版本的检查。

这是**机制教学示例，不是真实录屏或性能测试成绩**。真实过程并非固定六步：只有已声明并受支持的条件才会被程序检查，模型也可能遗漏需要声明的要求。

> 🎥 **真实操作录屏尚未发布。** 录制所需的任务、镜头顺序、核对字段与隐私检查已经整理在 [真实演示录制指南](docs/RECORD_DEMO.md)。目前不放置假录屏或虚构的运行结果。

## 快速开始

### 方式一：在本机部署（macOS 已验证）

准备 Git、**Node.js 22+**、npm 和 [Cloudflare `cloudflared`](https://developers.cloudflare.com/tunnel/downloads/)。

```bash
git clone https://github.com/zhangjinshuai0711/reasoning-harness-mcp.git
cd reasoning-harness-mcp
npm ci
npm test
npm start
```

启动后复制你自己生成的 **`mcp_url`**，在支持自定义 MCP 应用的 ChatGPT 环境中创建并连接应用。各账号/客户端是否有自定义 MCP 接入入口，取决于实际权限。

> **连接地址是凭据。** 不要公开随机路径、`.runtime/connection.json` 或终端完整输出。本地 Quick Tunnel 仅适合非敏感的临时测试，没有 OAuth 与用户隔离。

[安装与故障排查](docs/INSTALL.md) · [使用教程](docs/USAGE.md)

### 方式二：私有云端部署

希望跨设备使用同一个实例，可参考 [云端部署教程](cloud/README.md)。仓库**只公开源码，不提供所有人均可连接的公共服务**；每位使用者需部署或取得自己有权使用的实例。

### 接入后怎么用？

```text
@思序 中度：比较这两个方案，检查关键约束并给出结论。
```

```text
@思序 深度：对这道复杂排程题构建不同候选，比较并检查冲突。
```

默认中度；每次希望调用时需显式选择该应用。以实际工具调用和 `run_id` 确认它已运行。**深度**指工作流预算与比较规则，不是原生 High 模型。

## 核心能力

| 核心能力 | 具体做什么 |
| --- | --- |
| **多候选比较** | 深度模式要求至少两个候选进行实际比较，而不是只写一句“已考虑”。 |
| **版本化纠错** | `REVISE` 生成新版本；旧版本的审查不能冒充新版本证据。 |
| **有限程序校验** | 可执行已声明且受支持的算术、结构及部分约束检查，并记录结果。 |
| **可恢复任务状态** | 保存 `run_id`、阶段、候选和审查结果；按有效期查询与恢复。 |

适合尝试：多约束规划、方案权衡、可核对的计算题、代码边界条件以及需要审查修订记录的任务。

## 无需额外模型 API Key

思序本身**不调用其他模型或付费模型 API**；模型生成仍由当前聊天承担。因此不需要另行给思序提供 OpenAI API Key。

但多轮工具调用会增加时间和宿主模型生成量，仍受客户端订阅、权限、频率与用量限制。**目前没有足够统一的实验证据证明思序普遍优于普通 Instant、强化 Prompt 或原生高级推理。**

## 验证与技术资料

- [v0.4.0 发布与验收](docs/releases/v0.4.0.md) — 已验证的功能和部署范围
- [18 次首答实验](docs/PILOT-18-RESULTS.md) — 小规模结果及分批实验局限
- [六题对照基准](benchmarks/pilot-v02/README.md) — 测试题与判分条件
- [实验记录与能力边界](docs/EVALUATION.md) — 哪些结论有证据、哪些仍待验证
- [接口与校验定义](docs/V0.4.md) · [完整使用说明](docs/USAGE.md)

<details>
<summary><b>技术细节：工作流与本地管理</b></summary>

思序依据当前 `next_action` 推进，可能进入 `EXPAND`、`BRANCH`、`CHALLENGE`、`VERIFY`、`REVISE` 和 `FINALIZE`。动作不是固定顺序，也不代表多个独立模型采样。

<img src="docs/images/adaptive-reasoning-architecture.png" alt="Sixu adaptive reasoning architecture" width="850" />

```bash
npm run status
npm run doctor
npm run restart
npm run stop
```

`status` 可能包含完整连接地址，不要公开输出。本地线性兼容流程和云端 D1 持久化的差异见 [文档](docs/INSTALL.md)。

</details>

---

<div align="center">

**DON'T JUST ANSWER. EXPLORE. CHALLENGE. VERIFY.**

[**Get Started**](docs/INSTALL.md) · [**English README**](README.en.md) · [**Brand assets**](branding/README.md) · [**Demo recording guide**](docs/RECORD_DEMO.md)

<sub>SIXU · 思序 · v0.4.0 · Public source / self-hosted · 本仓库目前未指定开源许可证</sub>

</div>
