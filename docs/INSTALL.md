# 安装与接入

## 1. 准备环境

需要 Git、Node.js 22 或更新版本、npm，以及 Cloudflare 的 `cloudflared` 命令行程序。
已在 macOS 上验证。以下 Linux 安装指引依据官方文档整理，但未在本项目实测；
Windows 的进程启动与停止逻辑尚未验证。

检查 Node.js 和 npm：

```bash
node --version
npm --version
```

未安装 Node.js 时，从 [Node.js 官方下载页](https://nodejs.org/en/download) 安装 22 或更新版本，
然后重新打开终端。不要仅安装浏览器扩展，本项目还需要本地运行服务。

macOS 已安装 Homebrew 时：

```bash
brew install cloudflared
```

Linux 按架构从 [cloudflared 官方下载与安装说明](https://developers.cloudflare.com/tunnel/downloads/)
安装，确保以下命令可执行：

```bash
cloudflared --version
```

本项目使用 Quick Tunnel；该方式不需要配置 Cloudflare 账号或命名隧道，
但属于测试用途，没有可用性承诺。参见
[Cloudflare Quick Tunnels 官方说明](https://developers.cloudflare.com/tunnel/setup/quick-tunnels/)。

## 2. 下载并启动

```bash
git clone https://github.com/zhangjinshuai0711/reasoning-harness-mcp.git
cd reasoning-harness-mcp
npm ci
npm test
npm start
```

`npm start` 完成后会输出一份 JSON，其中：

- `mcp_url`：填入 ChatGPT 的完整 HTTPS 地址，必须保留最后的随机路径与 `/mcp`。
- `local_url`：本机程序客户端使用的地址，远程 ChatGPT 不能直接连接该地址。
- `server_pid` / `tunnel_pid`：后台服务与通道的进程编号。

教程不提供公共演示地址。使用你自己终端输出的 `mcp_url`；
不要把 `.runtime/connection.json`、终端完整输出或地址截图提交到 GitHub。
这个随机路径地址相当于连接凭据，本项目未实现 OAuth。

启动命令退出终端前台后，服务和通道仍在后台运行。用以下命令管理：

```bash
npm run status
npm run restart
npm run stop
```

启动器会等待 Cloudflare 通道注册后再输出 `mcp_url`。
若立即测试仍出现 `ENOTFOUND`、暂时的 502 或连接失败，先保持服务运行，
等待约 10–30 秒再重试；仍失败时检查 `.runtime/tunnel.log` 和本机网络。

`status` 显示状态和完整地址；`restart` 需要通道仍在运行，
保留地址并重启服务，线性流程的内存任务会清空；两小时内的自适应任务可恢复。`stop` 关闭两者。
停止后再 `npm start` 会生成新地址。不要删除正在运行的 `.runtime/connection.json`，
启动器通过它找到自己启动的进程。

## 3. 在 ChatGPT 中接入

截至 2026-11-08，OpenAI 的开发者模式说明给出以下网页端路径：

1. 打开 ChatGPT 网页端的 **Settings → Apps → Advanced settings → Developer mode**。
2. 启用开发者模式后，从 Apps 的 **Create app** 创建自定义 MCP 应用。
3. 名称填写 **思序 · Reasoning**，介绍和 PNG 图标可使用 [展示素材](../branding/README.md)。
4. 将刚才生成的完整 `mcp_url` 填入 MCP 服务地址。
5. 本项目没有 OAuth。如界面提供认证方式，选择无认证；访问限制来自随机 URL 路径。
6. 保存连接，在新聊天的工具或应用选择器中选择此应用。

各账号、工作区和客户端的入口可能不同，以实际界面为准。
若账号没有该入口，不要把“本地服务启动成功”当作“ChatGPT 已接入成功”。
本项目曾在一个 Plus 账号上跑通，不保证所有账号或桌面端提供相同入口；
建议先用网页端完成接入，再检查桌面端实际可见的应用。
需要 Instant 实验时，由使用者在界面自行确认目标模型，服务端无法认证模型身份。

仓库公开不等于你的 ChatGPT 应用已公开，也不提供一键安装链接。
每位使用者连接自己的服务；无需购买或提供模型 API Key。

依据：

- [OpenAI 开发者模式说明](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt)
- [OpenAI 自定义连接测试说明](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## 4. 检查接入

先在项目终端运行：

```bash
node reasoning-smoke.mjs --remote
```

预期看到 `transport: public-https` 和 `status: completed`。
这只是程序客户端连通性测试，下一步还必须在 ChatGPT 中实际调用工具。

在选择应用的聊天里发送：

> 用思序计算 (12+7)*2。调用 begin_reasoning，task 传入这个完整问题，
> feedback=none。按工具返回要求完成所有阶段，持续调用 advance_reasoning，
> 直到 completed 或 stopped。最后给出答案和 run_id。
> 不调用其他模型或付费 API。

预期得到 38，并实际出现工具调用和最终 `run_id`。
只有文字声称“已分步思考”，没有工具调用，不能算接入完成。
如果界面要求确认工具调用，按实际情况操作并记录；本项目不绕过宿主的确认机制。
更完整的启用指令和示例见 [使用教程](USAGE.md)。

## 5. 常见问题

| 现象 | 处理 |
| --- | --- |
| 找不到 `cloudflared` | 按第 1 步安装并检查版本，再启动 |
| `npm test` 通过但 ChatGPT 连不上 | 测试不覆盖公网连接；检查通道、完整 HTTPS 地址和目标账号入口 |
| 只能看到旧的工具定义 | 在应用连接设置中刷新工具定义；更新代码后先重启本地服务 |
| 停止重开后连不上 | 用新的 `mcp_url` 更新 ChatGPT 中的连接 |
| 提示 `Partial previous run exists` | 在同一项目目录先 `npm run stop`，再 `npm start` |
| `restart` 提示需要活动通道 | 通道已退出；停止并重新启动，再更新连接地址 |
| 提示任务过期或缺失 | 线性任务重启后失效；自适应任务可在两小时内从同一运行目录恢复 |
| Quick Tunnel 无法建立 | 查看本机 `.runtime/tunnel.log`；检查网络与官方文档所述的本机配置冲突 |
| 首次出现 `ENOTFOUND` 或临时 502 | 保持服务运行，稍等后重试；新域名及通道可能尚未就绪 |
| 模型只描述计划，不调用工具 | 确认选择了应用，使用明确要求调用工具的提示词 |
| 工具返回 `rejected` | 用返回的当前 `stage_key` 按错误说明修正，不能把拒绝当作完成 |
| 隧道或端口被本机已有配置影响 | 对照官方 Quick Tunnel 限制排查；本项目不会改写其他隧道配置 |

日志包含任务和产物，排查时先删去私人内容及连接地址，再分享错误摘要。
