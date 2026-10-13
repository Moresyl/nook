# Nook 能力与边界

Nook 是本地 AI 工作台，面向聊天、文档和项目。已有实现与最终发行验收分别记录，**尚未发布版本**。

记忆删除支持安全默认取消、明确影响说明、长内容独立滚动、等待期间禁止关闭，以及失败保留／重试。最新默认标题、顶部定位和半透明表面的 1,557 项完整单元、类型、构建、五组原生专项及六组明暗／应用缩放通过；源码、新包和实际安装各通过 375 项／74 次正常退出。源码专项、包内和安装的记忆原图各 22 张逐张复核，原五个分发专项、便携七项、保留数据卸载、十一份运行记录和十二个标记恢复通过。完整参考界面与托管发布仍未完成。[专项](../verification/memory-delete-default-surface-focused-review-result.json) · [完整源码](../verification/memory-delete-default-surface-full-source-review-result.json) · [分发与卸载](../verification/memory-delete-default-surface-runtime-review-result.json) · [包内原图](../verification/memory-delete-default-surface-unpacked-visual-review-result.json) · [安装原图](../verification/memory-delete-default-surface-installed-visual-review-result.json)

设置支持六类未保存表单的离开确认、跨分类保留草稿、保存等待锁定与失败重试。最新 1,555 项单元、类型、构建及八组设置专项通过；完整源码、新包和实际安装各通过 373 项／74 次正常退出。原五个分发专项、便携七项、保留数据卸载及十一份匹配运行记录通过。源码专项、包内与安装设置原图分别复核 34 张；安装轮先前七张缩放差异的目测判断经原图像素测量更正，实际尺寸与三档缩放一致。完整参考界面与托管发布未完成。[设置与草稿](SETTINGS.md) · [本轮运行证据](../verification/settings-drafts-runtime-review-result.json) · [安装原始判断](../verification/settings-drafts-installed-visual-review-result.json) · [测量与更正](../verification/settings-drafts-installed-scale-correction-result.json)

最新全局搜索的尺寸、表面与定位修正已通过源码命令专项；同一 `c81b8c38` 新包和实际安装也已完成原完整回归及本机分发验收。[搜索专项](../verification/command-palette-acceptance-review-result.json)

| 能力 | 已有实现 | 主要边界 |
| --- | --- | --- |
| 聊天与模型 | 流式回复、停止与重试、回复版本、编辑、分支、临时聊天、独立草稿及 2–4 模型比较；Responses、兼容 API、Anthropic、Gemini GenerateContent、Azure、Ollama | 真实云服务质量、完整能力元数据与上下文计数；Gemini Interactions／Entra ID 未提供 |
| 输入与配置 | `/` 查找模板、助手、项目；变量模板、助手绑定、JSON／gzip 分享；显式记忆与工具过程 | 完整富文本和参考输入流程、更多交换格式与最大规模交互 |
| 文档与资料 | PDF／Office／OpenDocument／RTF 提取；PDF 原件离线阅读、查找与导出；图片输入；关键词／向量／混合检索 | OCR、旧 DOC／XLS／PPT、密码输入、其他原件版式、后台索引及真实检索质量 |
| 项目与工作树 | 分页文件树、编辑草稿、Git 审阅／暂存／提交、分支创建／切换／重命名／安全删除、真实终端、HTML 预览；工作树创建、登记、会话、固定、私有快照、新目录恢复、安全删除与自动清理 | 物理目录选择器、更多预览、远程 Git 与凭据窗口、跨平台进程 |
| 扩展与任务 | MCP 工具／资源／提示、OAuth；本地技能和权限隔离插件；单次／间隔／Cron 自动任务 | 远程目录与更新、扩展共享服务、MCP Elicitation／任务、第三方身份服务、系统通知与关闭后的后台服务 |
| 桌面与浏览器 | 命令搜索、快捷键、可选托盘、独立快速聊天、Markdown 导出；最多 16 个临时网页标签、导航、停止和重试 | 物理系统事件、持久网页历史、下载、网站权限、浏览器自动化、听写／语音 |
| 本地数据 | 完整 JSON／gzip 备份、凭据排除、原子恢复、资源与独立草稿保留；私有快照独立保存 | 256 MB 上限的完整性能、分卷／加密、远程同步和物理选择器 |
| 分发与品牌 | Nook 名称、独立图标、合法 Inter／系统中文、明暗主题；Windows 安装与便携构建、实际安装／卸载及许可审计 | 本机分发验收通过，原托管流水线与实际发布未完成；其他平台、更新流程和全部参考界面尚未验收 |

图片生成、离线模型下载管理、本地 API 服务、远程主机／SSH、WebUI／连接器及加密同步尚未提供。完整细项与各功能使用说明保留在[能力历史](CAPABILITIES-HISTORY-2026-10-13.md)。

此前分支候选通过 1,550 项单元、类型与构建。冻结 `10db2c6` 应用体的完整开发程序、新包与实际安装各通过 371 项和 74 次正常退出；每轮保留 39 份报告、581 张原图与 236 个匹配编译文件。本地分支专项 11 组通过；专项源码、新包与安装后各 34 张分支原图逐张复核，其余原图未全部视觉复核。原五个分发专项、便携七项、十一份匹配运行记录和卸载保留数据通过，八个原始及四个失败轮次标记的哈希恢复一致。首次安装的遗留计数失败与完整重跑分别保留。物理输入、系统 DPI、真实服务和全部参考流程仍需分别验收。[分支源码测试](../verification/project-branch-actions-unit-review-result.json) · [分支完整源码](../verification/project-branch-actions-full-source-review-result.json) · [分支分发](../verification/project-branch-actions-runtime-review-result.json) · [分支安装重跑](../verification/project-branch-actions-installer-retry-review-result.json) · [此前搜索候选分发](../verification/command-palette-runtime-review-result.json)

[当前发布状态](RELEASE.md) · [设计采用范围](DESIGN-ALIGNMENT.md) · [完整交付要求](DELIVERY.md) · [前轮完整源码证据](../verification/command-progress-full-source-review-result.json)

整理前的能力细目和全部旧验收记录逐字保留，历史 SHA-256 为 `6cdcbd746f22853316b81b612e6522d45341a3cf6d44480cb99ec9ee8ae81bc7`，未取消任何剩余交付要求。
