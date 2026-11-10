<div align="center">

<img src="branding/icon-upload.png" alt="Sixu Reasoning" width="110" />

# SIXU · 思序

### ⚡ STOP GUESSING. START REASONING.

**别让 AI 只给你一个答案。让它提出方案、挑战结论、检查错误，再交付结果。**

**Turn one-shot answers into a traceable reasoning workflow — right inside your chat.**

[![Version](https://img.shields.io/badge/version-v0.4.0-6D5DFB?style=for-the-badge)](CHANGELOG.md)
[![Protocol](https://img.shields.io/badge/protocol-MCP-23272F?style=for-the-badge)](docs/V0.4.md)
[![Runtime](https://img.shields.io/badge/runtime-Node.js%2022%2B-339933?style=for-the-badge)](package.json)
[![API Key](https://img.shields.io/badge/extra%20model%20API%20key-NOT%20REQUIRED-FF6A5C?style=for-the-badge)](#-不需要额外的模型-api-key)

[**🚀 5 分钟了解如何启动**](#-quick-start--快速开始) · [**📖 使用指南**](docs/USAGE.md) · [**☁️ 私有云部署**](cloud/README.md) · [**🧪 实验记录**](docs/EVALUATION.md)

</div>

---

## 🧠 Your model. A smarter workflow.

> **你不需要再购买一个模型。你需要一套让现有模型认真完成任务的流程。**

**SIXU / 思序** 是一款面向 ChatGPT 等支持自定义 MCP 工具的聊天环境的 **推理工作流编排器**。它让当前聊天模型把复杂任务拆成可管理的候选与检查步骤；外部服务负责记录任务状态、版本、约束和下一步动作。

模型负责提出答案，**思序负责让整个过程有章可循**：

```text
你的问题
   │
   ▼
💡 EXPAND       构建候选
   │
   ▼
🌿 BRANCH       需要时探索另一条路
   │
   ▼
🔍 CHALLENGE    对比方案、寻找薄弱点
   │
   ▼
🛡️ VERIFY       检查已声明的结构化约束
   │
   ├── 发现问题 → 🔧 REVISE 修订，并使旧审查证据失效
   │
   ▼
✅ FINALIZE     确认选中版本并记录未解决事项
```

**不是换模型，而是换一种解决问题的方法。**

## ✨ 为什么值得一试？

| | 能力 | 你得到什么 |
|---|---|---|
| 🧩 | **不止一个候选** | 深度模式要求比较至少两个候选，而不是只写“我考虑过其他方案”。 |
| 🔄 | **允许犯错，但必须留下修订记录** | `REVISE` 更新候选版本；旧版本审查不能冒充新版本证据。 |
| 🧮 | **让部分检查交给程序** | 对已声明的算术、字段、预算、依赖、互斥与排程条件执行有限的服务端检查。 |
| 🗂️ | **有状态，不靠模型硬记** | `run_id`、阶段、候选版本与检查结果由服务端保存，可按有效期恢复。 |
| 🎛️ | **按任务调整探索深度** | 默认中度，也可选择深度；预算限制无休止的循环。 |
| 💸 | **不要求额外模型 API Key** | 由当前聊天模型完成每个步骤；思序服务本身不调用其他模型或付费模型 API。 |

**适合尝试：** 多约束规划、方案权衡、可检查的计算任务、代码边界分析、需要显式记录修订的复杂问题。

**不要误解：** `deep` 是思序的工作流深度，**不是** ChatGPT 原生 High 推理档位；`completed` 表示流程完成，**不是**任意答案已被证明正确。现阶段尚不能宣称思序普遍提高正确率或达到原生高级推理模型水平。[查看实验与边界](docs/EVALUATION.md)。

## 🚀 Quick Start · 快速开始

### 选项 A｜本地试用（macOS 已验证）

准备 Git、Node.js **22+**、npm 和 [`cloudflared`](https://developers.cloudflare.com/tunnel/downloads/)。

```bash
git clone https://github.com/zhangjinshuai0711/reasoning-harness-mcp.git
cd reasoning-harness-mcp
npm ci
npm test
npm start
```

运行后会打印 `mcp_url`。将**你自己生成的完整 HTTPS 地址**填入 ChatGPT 自定义 MCP 应用的连接入口，然后选择该应用。具体的 [安装步骤与故障排查](docs/INSTALL.md) 中包含界面说明。

> ⚠️ `mcp_url` 中的随机路径相当于连接凭据，**不要分享到公开仓库或截图中**。Quick Tunnel 仅适用于非敏感的临时试用；本地服务没有 OAuth 与用户隔离，电脑休眠或断网也会影响连接。

### 选项 B｜私有云端部署

想在网页端和桌面端使用同一持久实例？按 [**私有云部署教程**](cloud/README.md) 搭建自己的服务。云端方案包含私有网关、D1 状态持久化和用户隔离。

> GitHub 公开的是**源码**，不是公共托管插件。作者现有实例仅供所有者访问；每位使用者需要部署并连接自己的实例。ChatGPT 是否支持自定义 MCP 应用取决于实际账号、工作区及客户端权限。

### 💬 接入后，一句话调用

```text
@思序 中度：帮我比较两个实现方案，检查主要约束并给出结论。
```

```text
@思序 深度：为这个排程问题生成不同候选，比较优劣，检查冲突并给出最终方案。
```

不指定时默认中度。**每轮需要使用时重新 @思序**；是否实际触发，应以工具记录和真实 `run_id` 为准，而不是只看模型的文字声明。

[查看完整用法](docs/USAGE.md) · [查看 v0.4 接口](docs/V0.4.md)

## 🔥 看得见的推理过程，而不是一句“已认真思考”

<div align="center">
<img src="docs/images/adaptive-reasoning-architecture.png" alt="Sixu adaptive reasoning workflow" width="850" />
</div>

- **EXPAND / BRANCH：** 生成候选，并根据任务情况探索不同路线。
- **CHALLENGE / VERIFY：** 提交针对目标候选版本的审查或检查。
- **REVISE：** 修改候选；旧版本证据过期，不能直接用于新版本完成确认。
- **FINALIZE：** 以服务端保存的选中版本形成最终结果，记录尚未解决的问题。

服务端按规则确定下一阶段，并设置候选数、修订次数和动作数上限。它不是独立的第二个推理模型，也不会偷偷调用付费模型。

## 🧪 Show the receipts · 我们验证了什么？

目前已实现并记录：**v0.4.0** 自适应工作流、版本化候选、深度模式双候选比较要求、有限的服务端程序检查，以及私有云端跨端状态读取的限定验收。

项目还公开了小规模首答实验和对照结果；这些试验**不能证明**思序普遍优于直接回答、强化提示或原生高级推理模式。服务端程序只能检查已声明的条件，不能保证题面被完整提取或找到全局最优解。

[📊 18 次首答实验](docs/PILOT-18-RESULTS.md) · [🧪 六题对照](benchmarks/pilot-v02/README.md) · [📋 验证记录](docs/EVALUATION.md) · [🛠 v0.4.0 发布与验收](docs/releases/v0.4.0.md)

## 💡 不需要额外的模型 API Key

思序的独立服务负责**编排、记录和有限程序检查**；生成候选、审查与修订仍由你当前聊天中的模型完成。因此无需另外为思序配置 OpenAI API Key。

这不代表无限量使用或没有成本：宿主聊天仍有订阅、工具权限、频率及使用额度限制，多轮调用会增加模型生成量和等待时间。

## 📚 Documentation · 文档导航

| 想做什么 | 去哪里 |
|---|---|
| 立即安装并连接 | [本地安装](docs/INSTALL.md) |
| 长期使用 / 多设备同步 | [私有云部署](cloud/README.md) |
| 学会中度、深度与恢复 | [使用教程](docs/USAGE.md) |
| 查看接口和校验格式 | [v0.4 技术说明](docs/V0.4.md) |
| 审核效果声明与边界 | [实验与能力边界](docs/EVALUATION.md) |
| 了解每次更新 | [CHANGELOG](CHANGELOG.md) |
| 使用图标与介绍素材 | [Branding](branding/README.md) |

<details>
<summary><b>🔧 开发者：本地管理与测试命令</b></summary>

```bash
npm run status
npm run doctor
npm run restart
npm run stop

npm test
node smoke.mjs
node reasoning-smoke.mjs
node reasoning-smoke.mjs --remote
```

后三个 smoke 命令需要启动本地服务。程序测试不等于真实 ChatGPT 对话验收；`npm run status` 可能输出连接凭据，请勿公开完整结果。

线性兼容流程可显式指定 `strategy=linear`。本地自适应状态保存在 `.runtime/adaptive/`，云端使用 D1；任务访问有效期为创建后两小时。详见对应文档。

</details>

---

<div align="center">

### 🚀 DON'T JUST ANSWER. EXPLORE. CHALLENGE. VERIFY.

**让 AI 的下一次回答，不止是一次回答。**

[**Get Started**](docs/INSTALL.md) · [**Read the Docs**](docs/USAGE.md) · [**Explore the Source**](https://github.com/zhangjinshuai0711/reasoning-harness-mcp)

<sub>SIXU · 思序 · v0.4.0 · Public source, self-hosted service · 当前仓库未指定开源许可证</sub>

</div>
