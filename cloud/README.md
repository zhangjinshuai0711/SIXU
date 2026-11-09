# 私有云端部署（v0.4.0）

适合希望在 ChatGPT 网页端与桌面端 Chat 模式使用同一个持久插件的用户。
作者的原私有站点已部署 v0.4.0 版本 7，并在网页端完成深度修订与内部算术检查，
桌面端读取了同一任务；验收依据及边界见 [发布记录](../docs/releases/v0.4.0.md)。
该站点不向 GitHub 访客开放。新用户需创建自己的 **owner-private Sites MCP 站点**，
不能将仓库中的作者 `project_id` 当成自己的站点。

此目录提供固定 HTTPS 云端入口的实现，替代“临时通道 → 本机”的部署路径。
`.openai/hosting.json` 保存作者站点的真实 `project_id`，仅供该站点的后续更新。
此配置不是通用的一键托管地址，也不代表访客已获得插件权限。

## 保留的行为

- 保留 `begin_reasoning`、`advance_reasoning`、`reasoning_status`。
- 通用任务默认 `adaptive_search`；固定题默认线性，显式 `linear` 保留。
- 默认中度预算 8 步，深度 12 步；保留硬预算、候选修订和证据可信度区分。
- 两条流程均复用本地版同一份推理实现，服务仍不调用模型或付费 API。
- 本地文件存储仍由 `adaptive.mjs` 提供；云端以数据库存储每次提交后的完整状态。
- 增加有限结构化内部校验，不提供任意自然语言语义验证器。

## 入口与存储

```text
ChatGPT / Codex
       ↓
Sites 私有访问与身份验证网关
       ↓
POST /mcp → 共用推理实现 → D1 状态存储
```

`cloud/worker.mjs` 是 Worker 的源入口；`npm run build:cloud` 将它及所需模块
打包成 `dist/server/index.js`，并复制发布所需的 hosting 声明。
打包产物不包含本地 `.runtime/`、连接凭据或既有用户实验数据。

`server/discover` 提供 MCP 2026-07-28 能力发现；同时保留传统 `initialize`、
`tools/list`、`tools/call` 和 `ping`。工具定义从原有注册函数生成，不维护第二份字段列表。
`GET /health` 检查数据库表可用性；数据库缺失时返回 503。

v0.4 在 `initialize`、能力发现和工具描述中要求本轮明确调用。
上一轮 @ 不延续到下一轮；服务端不监听聊天。新部署仍需在宿主内验收工具选择。
状态格式 v4 只推进新任务，旧自适应状态保持只读，旧线性任务按原协议继续；
本版无需数据库表迁移。详见 [接口说明](../docs/V0.4.md)。

任务按 Sites 网关提供的 `oai-authenticated-user-id` 隔离，不能用另一个用户的
`run_id` 读取或改写状态。该请求头必须来自平台已验证的网关：
本入口不是可直接裸露到公网、依赖任意客户端自报身份的认证实现。
只按本说明发布到受验证网关保护的私有 Sites，不开放匿名原始 Worker 入口。

访问期限保持创建后两小时；过期任务不能再读取或推进。
这是访问期限，不是精确的物理删除定时器：同一用户开始新任务时清理其过期记录。
未继续使用的账号可能保留过期数据库行，当前没有后台定时删除任务。
每用户最多 64 个未过期任务，插入时原子检查；每条完整状态最多 1 MiB。

每次推进根据数据库 revision 做条件更新。同时提交旧状态时，至多一个写入成功；
冲突返回 `STATE_CONFLICT`，要求先读 `reasoning_status`。
失败不会以客户端内存中的新答案冒充数据库已保存结果。
状态查询不写数据库。任务与阶段产物不写入通用应用日志。

## 构建与验证

```bash
npm ci
npm test
npm run build:cloud
npm run check:bundle
npm run check:performance
```

本地测试使用 Node 标准库 SQLite 执行真实迁移 SQL，通过一个 D1 接口适配层调用 Worker。
覆盖两条完整流程、跨 Worker 实例恢复、用户隔离、过期清理、并发冲突、配额、
未配置存储、请求大小和解析错误。它不等于真实 D1 服务或公网发布验证。
最终打包文件也单独完成了 Node + SQLite 的完整自适应流程检查。
本次 v0.4.0 的 68 项本地测试、构建及打包检查通过；线上专项结果单列于发布记录，
不把本地测试当作实际 D1 或聊天客户端的验收。

## 部署自己的私有站点

使用可创建 Sites 的 ChatGPT 工作区，并在该环境中让 Sites 从这份仓库源码
构建和发布。需要 Git、Node.js 22+ 和 npm 来做本地检查；云端路径**不需要**
`cloudflared`、OpenAI API Key，也不需要运行本地 `npm start`。
账号/工作区若没有 Sites 创建能力，不能仅靠 `git clone` 得到云端连接。

1. 克隆仓库或下载所需版本源码，运行上面的验证命令。新建站点时，先从你自己的
   **部署副本**的 `.openai/hosting.json` 移除作者的 `project_id` 字段；
   保留 `"d1":"DB"`、`"r2":null` 和 `"capabilities":["mcp"]`。
   不要用作者的站点 ID 覆盖自己的项目，也不要提交含个人凭据的文件。
2. 在 Sites 中**只创建一次** owner-private MCP 站点，保存平台返回的
   `project_id` 到部署副本的 `.openai/hosting.json`。如果已经有自己的站点，
   不再创建，保留原有 `project_id`、私有受众和数据库绑定。
3. 将这份源码同步到该站点的源码仓库，运行 `npm ci`、`npm test`、
   `npm run build:cloud`、`npm run check:bundle`。发布包必须包含
   `dist/server/index.js` 和带自己 `project_id` 的 hosting 声明。
   首次部署应用 `drizzle/0000_reasoning_runs.sql`，核对 D1 逻辑绑定名为 `DB`；
   该迁移只有建表，不应通过清空已有数据库“重新安装”。
4. 保存对应源码提交的 Site 版本，再将**同一版本**部署为 owner-private。
   等待部署状态变为 `succeeded`，核对版本 ID、部署 ID、源码 SHA 和 MCP 连接。
   更新现有站点时沿用原站点及插件，不能另建一个看似成功但没有旧状态的站点。
5. 在 Plugins 的个人插件中安装或连接 Sites 创建的 MCP 插件。网页端先确认
   `begin_reasoning`、`advance_reasoning`、`reasoning_status` 三个工具确实可见；
   桌面端 Chat 模式再检查同一插件是否可用。界面入口依账号和客户端能力而异。

原站点的维护者从第 2 步“已有自己的站点”分支开始，不删除 `project_id`，
不重建或清空 D1。源码同步所需的写入凭据仅通过受支持的私密通道传入，
不要放进仓库、命令行参数、截图或公开日志。

## 聊天端验收与排错

部署成功不等于工具已同步，也不等于答案正确。先在网页端发起非敏感新任务：

> @思序 深度：计算 18×24+75。先建立答案为 497 的受控错误候选，
> 再建立独立计算得到 507 的第二候选；登记错误，按返回动作修订第一个候选，
> 用当前版本与第二候选比较审查并完成。报告实际 run_id、状态和校验等级。

应看到 `REVISE`、C1 从 v1 升到 v2、审查中的 `compared_candidate_ids=["C2"]`，
最后 `status=completed`。这项测试仅为模型审查，预期是 `model_review_only`。
程序算术检查的结构化参数及测试见 [v0.4 接口说明](../docs/V0.4.md)；
只有返回 `checks_executed=1`、`verification=service_executed`、
`passed=true`，才可称实际执行了程序检查。

然后在桌面端 Chat 模式选择**同一插件**，只调用 `reasoning_status`，
传入网页端实际取得的 `run_id`，核对 `final.answer/result`、
`verification_status` 及 `checks_executed`。过期后不能再恢复；
跨端成功只证明这两个已测试客户端共享授权任务状态。

若 `tools/list` 仍为旧定义或缺少 `review/checks`，核对实际部署 SHA、部署状态、
插件同步结果和新聊天可见的工具定义。单凭返回 `service_version=0.4.0`
无法区分同版本前后修复；不要盲目重复新建站点或清除数据库。
`INVALID_ARGUMENTS` 且未返回 `run_id` 时先按字段提示修正后重新 begin；
已有 `run_id` 时用 `reasoning_status` 查询保存状态。

## 实验记录

两批共 18 次首答和独立重试已整理，方法限制见
[完整记录](../docs/PILOT-18-RESULTS.md)。保留原记录，不用 v0.4 程序回放替换首答。
本版不组织手工模型对照；程序客户端与构建检查不记为 Instant 效果试验。

## 维护与上线安全

在受支持的 Sites 运行时配置中设置字符串 `SIXU_READ_ONLY=true`，
即可暂停 begin/advance 并保留授权用户的状态查询。该开关不开放为客户端工具，
不删除数据库；解除时设为 `false` 或移除配置。上线失败优先启用维护模式，
不要把已写入 v4 状态的数据库交给旧写入逻辑处理。
