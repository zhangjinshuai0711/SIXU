<div align="center">

<img src="branding/sixu-hero.svg" alt="SIXU 思序 · Stop guessing. Start reasoning. 带状态的推理工作流" width="100%" />

**⚡ ChatGPT Instant × SIXU — 为共享额度时代而设计的外部推理工作流。**

### **12 月起，ChatGPT + Codex 共享额度；Instant Chat 不从共享额度扣除。**

**让 Instant 不止于一次回答。** 利用 Sixu 的候选探索、审查、修订和状态管理，把需要高级推理额度的任务留给更适合它们的原生推理模式与 Codex。

[**立即使用 Instant + Sixu**](#在-chatgpt-instant-中使用) · [**为什么 12 月值得关注**](#为什么-instant--sixu-值得关注) · [**查看工作流程图**](#思序如何为-instant-组织推理)

[![Version](https://img.shields.io/badge/version-v0.4.0-715DF2)](CHANGELOG.md)
[![Protocol](https://img.shields.io/badge/MCP-workflow-2B4375)](docs/V0.4.md)
[![Hosting](https://img.shields.io/badge/deployment-self--hosted-2B8F88)](cloud/README.md)
[![API](https://img.shields.io/badge/extra%20model%20API%20key-not%20required-8D5CD6)](#无需额外模型-api-key)

**[快速开始](#快速开始)** · **[真实对照](#真实对照instant-vs-sixu)** · **[安装教程](docs/INSTALL.md)** · **[English](README.en.md)**

</div>

---

## 一句话理解思序

**SIXU（思序）是一个面向支持自定义 MCP 工具的聊天客户端的推理工作流编排器。** 当前聊天模型负责生成候选和审查内容；思序服务负责阶段调度、候选版本、任务状态，以及已声明且受支持的程序检查。

它**不是新的大模型**，也不会调整 ChatGPT 的原生推理档位。它的作用，是让复杂任务的处理过程更有结构、可以复查。

## 为什么 Instant + Sixu 值得关注

OpenAI [官方说明](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits)：**从 2026 年 12 月起，Plus、Pro、Business 的 ChatGPT 与 Codex 将共享按 Token 计量的使用额度，而 Instant Chat 不从这份共享额度中扣除。**

| 原生高级推理 / Codex | **ChatGPT Instant + Sixu** |
| --- | --- |
| 需要按适用规则消耗共享额度 | **Instant Chat 按官方说明不扣共享额度** |
| 模型可使用原生更高推理投入 | **不改变 Instant 的原生推理档位** |
| 适合难度更高、价值更大的模型任务 | 尝试用外部多阶段流程处理**可检查、有明确约束**的问题 |
| 不一定需要用户额外部署服务 | 需要可用的自定义 MCP 应用接入；Sixu 服务不另调用付费模型 API |

**核心思路：先用 Instant + Sixu 处理适合工作流增强的问题；遇到真正需要更强原生推理的任务，再用 Medium、High 或 Codex。**

> **额度说明：** “Instant Chat 不扣共享额度”是官方公布的额度计量规则，**不等于 Instant、外部工具和 MCP 调用完全无限制**。Sixu 是否可以在你的 ChatGPT Instant 环境使用，取决于客户端和账号的工具权限。插件也无法保证模型达到原生 High 水平或显著提升任意问题的准确率。实际用量以 ChatGPT **Settings → Usage** 为准。政策可能更新，以上依据 [OpenAI 官方说明](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits)（2026-11-10 核对）。

## 思序如何为 Instant 组织推理

<div align="center">

<img src="branding/sixu-instant-flow.gif" alt="ChatGPT Instant 与 Sixu 的动态推理工作流：INPUT、EXPAND、BRANCH、CHALLENGE、VERIFY、REVISE、FINALIZE，并展示条件性的修订回路" width="100%" />

<sub>动态架构示意 · 按需探索和修订，阶段不一定逐项发生；只有已声明且受支持的条件才由程序检查。</sub>

</div>

**当前聊天模型负责生成候选，Sixu MCP 负责持久化状态、约束流程、版本管理和有限程序校验。** 深度模式要求候选比较；当需要修订时，旧审查不能用于新候选版本。实际动作由服务端返回的 `next_action` 决定，完成流程不代表任意结论得到独立证明。

[查看 v0.4.0 协议与校验](docs/V0.4.md) · [完整使用指南](docs/USAGE.md)

## 真实对照：Instant vs Sixu

**2026-11-10 · ChatGPT Instant 模式 · 相同题目，两种回答方式**

> 下列问答依据两段公开对话的**用户提供截图**整理，属于便于阅读的**模拟问答排版**，并非逐字转录。两条公开对话链接可供对照；本例不是严格控制变量的性能测试。

### 提问：5 个项目，如何找出最大总价值？

**用户（两次测试使用的同一道题）**

> 有 5 个项目：
>
> | 项目 | 成本 | 价值 |
> | :---: | ---: | ---: |
> | A | 4 | 9 |
> | B | 3 | 8 |
> | C | 5 | 12 |
> | D | 2 | 6 |
> | E | 4 | 10 |
>
> 预算不超过 **10**。选择 **C 必须同时选择 A**；**B 与 E 互斥**。
>
> 求最大总价值；价值相同时成本最低。请比较至少两种方案，并验证最优性。

### 回答 ①：仅使用 ChatGPT Instant

**ChatGPT（根据截图整理）**

> 初步给出的组合是 **B + D + E**，成本 **9**、价值 **24**，但该方案**违反 B 与 E 互斥约束**，因此不可行。
>
> 重新核对后，正确最优选择是 **A + D + E**：
>
> | 方案 | 项目组合 | 成本 | 价值 | 结论 |
> | --- | --- | ---: | ---: | --- |
> | S1 | B + D + E | 9 | 24 | ❌ B、E 互斥 |
> | S2 | A + B + D | 9 | 23 | ✅ 可行 |
> | S3 | **A + D + E** | **10** | **25** | ✅ 最优 |
> | S4 | B + D | 5 | 14 | ✅ 可行 |
> | S5 | A + C | 9 | 21 | ✅ 可行 |
>
> **全局最优性验证：按约束分情况讨论。**

> **情况一：选择 C。** C 必须搭配 A，`A+C` 成本 9、价值 21；添加其余任意项目均超出预算，本情况最高价值 **21**。
>
> **情况二：不选择 C，选择 E。** B 与 E 互斥，只能从 A、D 中继续选择；`A+D+E` 成本 10、价值 25，优于 `A+E`（价值 19）、`D+E`（价值 16），本情况最高价值 **25**。
>
> **情况三：不选择 C，也不选择 E。** 只能在 A、B、D 中选择；`A+B+D` 成本 9、价值 23，本情况最高价值 **23**。
>
> 三种情况覆盖全部可行解，故 `max(21, 25, 23) = 25`。
>
> **最终答案：** `A + D + E`，总成本 `10`，总价值 `25`。

**观察：** Instant 在**同一次回答内**发现并纠正了先前的互斥错误，无需额外插件。

[查看原始对话：仅 Instant](https://chatgpt.com/share/6af2f8d9-bf64-83ee-95bd-148e626523ea)

### 回答 ②：ChatGPT Instant + SIXU Deep

**用户（对同一道题调用 SIXU 深度工作流）**

> 使用思序比较候选方案，检查预算、依赖与互斥条件，给出最优解，并报告实际工作流状态。

**ChatGPT + SIXU（根据截图整理）**

> **最终选择：A + D + E，总成本 10，总价值 25。**
>
> | 候选 | 选择项目 | 总成本 | 总价值 | 结果 |
> | --- | --- | ---: | ---: | --- |
> | C1 | **A + D + E** | **10** | **25** | **最优** |
> | C2 | A + B + D | 9 | 23 | 次优 |
> | C3 | A + C | 9 | 21 | 可行 |
>
> **候选比较：** C1 比 C2 多花费 1，但总价值增加 2，因此符合优先最大化总价值的目标。
>
> **全局最优性验证（回答正文中的穷举论证）：**
>
> - 5 个项目各有选择或不选择两种状态，共 `2^5=32` 种组合；
> - 回答声称检查全部组合后，**13 种满足约束（含空集）**，其余 **19 种不满足约束**；
> - 13 种可行组合中最高价值是 **25**，唯一达到此价值的方案是 **A+D+E**，无需同价值下再比较成本。
>
> 请注意：以上是**截图中模型给出的论证**，本次工具记录显示服务端程序检查 0 次，不能据此宣称 SIXU 服务端完成独立程序穷举。
>
> 对最终组合核对：
> - 成本 `4 + 2 + 4 = 10`，不超过预算；
> - 未选 C，不触发「选 C 必须选 A」；
> - 未选 B，满足「B 与 E 互斥」。
>
> **截图中显示的 SIXU 实际执行记录：**
>
> | 字段 | 记录值 |
> | --- | --- |
> | `run_id` | `6bfbbc33-3ac6-40f6-bed3-a01b8c380d42` |
> | `status` | `completed` |
> | `depth.actual` | `deep` |
> | 候选数量 | `2` |
> | 选中候选 | `C1 v1` |
> | 执行步骤 | `3` |
> | `verification_status` | `model_review_only` |
> | 服务端程序检查次数 | `0` |
> | 未解决问题 | `0` |
>
> **最终答案：** `A + D + E`，总成本 `10`，总价值 `25`。SIXU 记录了深度候选比较与模型审查；**本次未执行服务端程序化最优性验证**。

**观察：** SIXU 回答中给出了“32 种组合、13 种可行”的穷举结论，但工具记录仍是 `model_review_only` 和程序检查 0 次，**不能把回答文字等同于服务端实际程序穷举**。SIXU 展示了可追踪的候选比较、版本与运行状态。但回答中展示的三个方案不等于服务端创建了三个候选；**工具记录的候选数量是 2**。

[查看原始对话：Instant + SIXU](https://chatgpt.com/share/6af2f8a7-204c-83ee-90e7-ec4f938d98f6)

### 结果对照

| 维度 | Instant | Instant + SIXU Deep |
| --- | --- | --- |
| 最终组合 | **A + D + E** | **A + D + E** |
| 最终价值 / 成本 | **25 / 10** | **25 / 10** |
| 约束处理 | 回答内识别错误并自我修正 | 候选比较与模型审查 |
| 运行状态可查询 | 无 SIXU 工作流记录 | `run_id`、候选版本、`completed` |
| 服务端程序检查 | 不适用 | **0 次** |
| 本例能否证明插件更准确 | **不能** | **不能** |

<details>
<summary><b>全局最优性的独立核对（不属于本次 SIXU 服务端检查）</b></summary>

5 个项目各有选或不选两种状态，共 `2^5 = 32` 种组合。独立检查预算、依赖和互斥限制后，**13** 种组合可行（含空集），最大价值为 **25**，且仅 `A + D + E` 达到该值。这里的穷举结果用于核对题目答案，**不能归因为 SIXU 实际执行了枚举或程序检查**。

</details>

<div align="center">

<img src="docs/images/instant-vs-sixu-demo-en.png" alt="Instant vs SIXU Deep: candidate comparisons, case analysis versus reported enumeration, model_review_only with zero server-side checks; both find A + D + E" width="100%" />

<sub>英文高清 PNG 对照图（依据截图和补充原文重新排版，并非原始聊天截图）；清楚区分模型声称的穷举论证与 SIXU 服务端实际检查。</sub>

</div>

[实验记录与能力边界](docs/EVALUATION.md)


## 一个具体例子

<div align="center">
<img src="branding/sixu-revision-story.svg" alt="教学示意：18 乘 24 加 75，候选错误值 497 在声明的算术检查中失败，经修订后得到 507" width="100%" />
</div>

**假设**某个任务的候选结果是 `497`，而题目要求计算 `18 × 24 + 75`。当客户端确实提交了对应的结构化检查，服务可标记检查失败；模型随后修订候选为 `507`，再接受针对新版本的检查。

这是**机制教学示例，不是真实录屏或性能测试成绩**。真实过程并非固定六步：只有已声明并受支持的条件才会被程序检查，模型也可能遗漏需要声明的要求。

## 在 ChatGPT Instant 中使用

**使用路径：** 在 ChatGPT 中选择 **Instant** → 选择你已连接的 **Sixu / 思序** 自定义 MCP 应用 → 发送带 `@思序` 的问题 → 以真实工具结果的 `run_id` 确认任务已执行。

```text
@思序 深度：使用当前 Instant 分析这个问题，生成不同候选、对照并检查关键约束；必要时修订，最终报告实际 run_id 和验证状态。
```

这里的“深度”指 **Sixu 外部流程深度**，不切换 ChatGPT 模型为 High。若当前账号/客户端不允许 Instant 调用该 MCP 应用，请先确认权限，而不是把未成功调用当作已执行。

## 快速开始

### 方式一：在本机部署（macOS 已验证）

准备 Git、**Node.js 22+**、npm 和 [Cloudflare `cloudflared`](https://developers.cloudflare.com/tunnel/downloads/)。

```bash
git clone https://github.com/zhangjinshuai0711/SIXU.git
cd SIXU
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

默认中度；需要使用时请在本轮显式调用，凭实际工具记录与 `run_id` 确认运行。**深度**指外部工作流预算与比较规则，不是原生 High 模型。

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

[**Get Started**](docs/INSTALL.md) · [**English README**](README.en.md) · [**Brand assets**](branding/README.md)

<sub>SIXU · 思序 · v0.4.0 · Public source / self-hosted · 本仓库目前未指定开源许可证</sub>

</div>
