# SIXU · 思序品牌指南

**品牌主标志：分支节点构成的渐变 S。** 使用青色、深蓝、紫色与洋红色，表达候选探索、比较、校验和修订。各页面的品牌母版统一采用 `sixu-symbol.svg`。

## 官方展示资产

| 场景 | 资产 | 状态 |
| --- | --- | --- |
| 品牌源 Logo | [sixu-symbol.svg](sixu-symbol.svg) | GitHub README 统一使用的主标志 |
| GitHub 横幅 | [sixu-hero.svg](sixu-hero.svg) | 与主 Logo 相同的 S 路径 |
| **首页动态推理流程图** | **[sixu-instant-flow.gif](sixu-instant-flow.gif)** | **GitHub README 主展示，七帧 GIF，避免 SVG 动画兼容性问题** |
| 备用 SVG 源文件 | [sixu-instant-flow.svg](sixu-instant-flow.svg) | 矢量设计源，**不再嵌入 README** |
| 社交分享封面候选 | [sixu-social-preview.svg](sixu-social-preview.svg) | 待导出 PNG 并在仓库 Settings 中设置 |
| 错误→修订→校验案例 | [sixu-revision-story.svg](sixu-revision-story.svg) | 教学示意，非真实运行录屏 |
| 真实对照高清图 | [../docs/images/instant-vs-sixu-demo-hd.svg](../docs/images/instant-vs-sixu-demo-hd.svg) | 依据用户公开对话截图重绘的静态矢量图，首页使用 |
| 原阶段 GIF | [sixu-workflow.gif](sixu-workflow.gif) | 旧版概念动画，留作兼容，不作为首页主演示 |
| SVG 阶段动画 | [sixu-workflow-animated.svg](sixu-workflow-animated.svg) | 备用概念动画 |

<img src="sixu-symbol.svg" alt="SIXU gradient S logo" width="128" />

<img src="sixu-hero.svg" alt="SIXU hero banner" width="100%" />

## 插件安装图标与兼容性

`icon.svg` 已同步为新版 S 标志。原有的 `icon-upload.png`、`icon-256.png`、`icon-1024.png`、`icon-64.png` 和 `icon-32.png` 仍是**早期 PNG 兼容素材**；它们不会自动因为 README 更换 Logo 而更新 ChatGPT 里已经部署的应用图标。

为避免破坏现有应用安装和历史引用，这批文件在统一导出并核对上传要求之前保留。**它们不应再被新宣传页面当作官方主 Logo。** 完成一次统一导出后，可以将各尺寸 PNG 更新为同一 S 母版，并在 ChatGPT 的应用配置中单独更新上传图标。

如使用图像工具从 SVG 导出 PNG，应核对 32/64/256/1024 等目标尺寸和平台上传体积限制，不能只重命名 SVG 为 PNG。

## 设计与陈述原则

- 使用准确的产品事实：MCP 工作流、版本化候选、有限的已声明结构化检查、状态管理；不把 `deep` 宣称为模型原生 High。
- 不能把 `completed` 当成全部结果“已证实”。
- 解释示意图加“教学示意”标识；真实对照使用公开对话核对，矢量重绘不可冒充原始截图或程序验证记录。
- 动画、Banner、社交图使用同一主标志；避免重新设计与主 Logo 不同的 S。首页只展示 `sixu-instant-flow.gif`，旧图表与 SVG 源文件仅作为历史/设计资产保留。
- 不使用“官方认证”“100% 正确率”“无限额度”等未经证实的营销词。
- 代码已公开，但仓库当前未指定许可证；不要直接称为具有某种开源许可。

## 元数据建议（需要在 GitHub 仓库设置中另行保存）

- Description: `Turn one-shot LLM answers into stateful, reviewable reasoning workflows with MCP. Explore, challenge, verify, revise.`
- Topics: `mcp`, `chatgpt`, `llm`, `reasoning`, `reasoning-harness`, `ai-agent`, `self-hosted`
- Social preview: 将 [sixu-social-preview.svg](sixu-social-preview.svg) 导出为 PNG 后，在 GitHub 的 **Settings → General → Social preview** 设置。

以上是建议文本；并不代表 GitHub 的 About、Topics 或 Social preview 已自动更改。
