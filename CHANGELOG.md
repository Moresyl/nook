# 更新记录

## 未发布

- 新增会话任务步骤：保留最新有效记录和工具原文；无效更新保留旧记录，停止后待继续，重启保留草稿。
- 共享按钮采用 24px／8px／4px 与 13px 字号；普通单行表单采用 32px 高、8px 圆角、12px 内距和内描边。聊天输入区保留 22px 外圆角与窄视口浅色阴影。
- 工作树只读身份查询按四项一批执行，独立 Git 元数据读取并行等待；删除仍串行，原文件、索引与删除前复查保留。
- 发布与安装门槛提高为 383 项，严格验证八组任务步骤行为、十二种布局、逐项可读边界和十六张完整捕获。原期限与覆盖率门槛保持不变。
- 设置搜索保留外层焦点圈，去除内层重复矩形描边；快速聊天标题保持 22px 紧凑高度，避免小窗口高缩放挤出模型操作。
- 代码块采用当前明暗代码表面、8px 圆角、对应内距与相对字号／行高。复制提供成功／失败反馈，等待时禁止重复写入；代码和工具原文共用异步版本保护，原文改变或组件关闭后不接受旧完成状态。
- 聊天正文查找排除代码复制的成功和失败提示，继续保留真实代码内容与精确高亮。
- 当前应用体 `fa11763` 的新类型检查、构建，以及源码、新包和实际安装各 386 项／75 次正常退出通过。完整 136 文件／1,602 项单元运行的 278 个覆盖、测试、依赖及配置输入保持一致，渲染器复制和搜索另由原生套件验证。原五项分发专项、十一份匹配记录和保留数据卸载通过。源码 12 张代表原图逐张查看，包内与安装各 8 张新图逐张查看及 4 张与源码原图完全一致；分发控件 26 张／文字提示 12 张全部逐张查看，每轮 633 张完整原图未全部视觉复核。
- 精简发布、能力和设计说明，完整保留许可证、旧轮次、原始截图和失败证据。完整参考界面、物理交互与托管发布尚未完成。

Task records retain valid steps, exact tool history and unsent drafts across restart. Code and tool copying share stale-completion protection, and copy feedback stays outside body search. The complete 1,602-test coverage run applies to unchanged covered inputs; renderer behavior is verified natively. Source, unpacked and installed runtimes each pass 386 checks with 75 normal exits, alongside the original distribution and data-preserving uninstall gates. Complete reference parity and hosted publication remain pending.

[发布状态](docs/RELEASE.md) · [原文历史](docs/CHANGELOG-HISTORY-2026-10-14.txt)，历史 SHA-256：`5734f75f345be6cfbb3933243992cdd1f18580313bcb3b926c891d46531fe854`。

## [0.1.0-alpha.1] - 2026-10-13

Nook 是一个本地 AI 工作台，用于对话、资料阅读和项目开发。首个 Windows x64 预发布候选，尚未发布。

### 新功能

- **任务步骤**：项目分析与执行模式可在会话内记录最多 20 项步骤，展示模型标记的完成数量，保留每次工具输入与结果。错误更新保留上一份有效记录；停止后未完成步骤显示“待继续”，重启保留记录和草稿。记录本身不会执行步骤或写入项目计划文件。

- **对话与模型**：连接 Responses、OpenAI 兼容接口、Anthropic、Gemini、Azure 和 Ollama；支持流式回复、停止与重试、回复版本、消息编辑、对话分支，以及同一问题的 2–4 模型比较。
- **快捷选择**：主工作台和快速聊天输入 `/` 可查找模板、助手和项目。支持键盘选择和光标处插入变量模板；取消保留原文，选择不会发送消息。
- **上下文与工具**：生成、编辑并选用上下文摘要，继续保留完整原文；原文变化后恢复完整历史。工具记录展示状态、耗时和操作摘要，可展开、复制及失败重试。
- **资料阅读**：导入文档、文本和图片，管理关键词／向量／混合检索资料集。PDF 保留原件，支持离线阅读、目录、查找、原字节导出、备份恢复和显式加入聊天。
- **项目工作台**：分页文件树、代码编辑与草稿、Git 审阅／暂存／提交、本地分支创建、切换及重命名，真实终端，以及 HTML 草稿的独立或并排预览。可删除已完全合入当前版本的未占用本地分支，当前分支、其他工作树及未合入提交会保留。
- **独立工作树**：从新分支或未占用的本地分支创建工作树，保留源仓库改动。支持默认根目录、可选获取上游、关联会话、项目登记、本机固定、私有快照和恢复到新目录；获取或登记失败保留可重试状态。
- **助手与扩展**：助手、变量提示模板、显式记忆、自动任务、MCP 工具／资源／提示与 OAuth、本地技能和隔离插件；临时浏览器提供独立标签及键盘导航。
- **本地备份**：导出 JSON 或 gzip 工作台，保留普通聊天、附件、资料库、草稿和扩展资产。恢复后插件需要重新授权，临时聊天不进入持久历史或完整备份。
- **设置草稿**：模型连接、桌面快捷键、工作树、MCP、插件权限和记忆离开未保存表单前显示紧凑确认。默认继续编辑，回车和 Escape 保留输入；保存等待防止重复操作，失败保留草稿供重试。

### 变更与安全

- 名称、图标和 Windows 产品信息统一为 **Nook**，兼容读取已有数据；保留原始开源许可证、依赖和安装组件来源说明。
- 密钥本地加密并绑定连接目标，共享备份不含密钥。插件按能力和项目范围授权；文件修改、命令及远程工具展示具体操作。
- 网页、预览和插件保持隔离，外部网页无法使用工作台桥接或 Node；预览、导出不会自动调用模型。
- 工作树登记重新核对 Git 归属、来源及规范路径。外部工作树不会因登记获得自动清理权限，本机管理记录和私有快照不进入共享备份。
- 删除前保存可恢复快照，保护源仓库、分支、固定／已登记项目、固定聊天、运行中的回复或终端、草稿及含改动目录。恢复仅写入尚不存在的新目录。
- 创建后自动清理默认关闭，可保留 1–50 个合格的最近工作树；停用需确认。快照保存失败或达到原有上限时停止清理，退出等待已接受的保存与清理操作。

### 修复与完善

- 普通单行表单和下拉框采用 32px 高、8px 圆角、12px 内边距与 13px 字号，分别保留输入聚焦、下拉展开、键盘圈和非法状态。按钮取消额外实体边框，统一默认 400 字重与 150ms 过渡；模型和工具下拉使用紧凑规格。
- 快速聊天的会话标题保留 22px 紧凑高度，修复普通表单尺寸继承导致小窗口高缩放时模型操作区被挤出的情况。
- 设置搜索移除内层输入的重复矩形描边，保留外层搜索框的描边和键盘焦点圈，覆盖默认、悬停与聚焦状态。
- 代码块修正主题表面、8px 圆角、正文内距与相对字号／行高，保留代码原文、自动换行和隔离图表。复制成功明确提示，失败保留原文供重试，等待期间防止重复写入；流式原文变化后拒绝旧复制反馈。

- 全局搜索采用 520px 宽度上限和随窗口收缩的布局，明暗表面与居中定位单独适配；键盘移到列表末项时保留滚动留白。
- 输入框采用当前主题的 22px 默认圆角，窄视口收紧浅色阴影，保留原有输入、发送、草稿和键盘行为。
- 共享按钮采用当前默认高度、内距与内容间距；保留附件关闭和设置搜索清除的小尺寸入口，键盘焦点及禁用状态分别核对。
- 修复连续命令输出的最后一段可能等到下一段或进程结束才显示的问题，保留 100 毫秒通知节奏及关闭、报错、取消后的清理。
- 修复选择助手或项目后的光标恢复覆盖用户新选区，导致后续输入重复前缀的问题。
- 修复编辑器文件标签和关闭按钮的键盘焦点圈被横向滚动条裁切的问题；工作树刷新及设置保存完成后保留正确焦点，用户已切换控件时不抢焦点。
- 设置支持分类和字段搜索，切换分类保留未保存草稿；统一明暗主题、共享控件、文字提示和窄窗口导航。
- 记忆删除默认聚焦取消，删除等待期间禁止关闭，失败保留内容供重试。确认框修正默认标题字重与字距、顶部定位、半透明表面和关闭控件，长正文独立滚动，操作按钮保持可见。
- 修复草稿保存、分支导航、多路流式检查点和恢复等待的竞争；保存失败保留输入、原文与重试能力，恢复异常保留原资料。
- 工作树逐项目显示结果、等待和脱敏错误；管理记录加载期间禁用写操作，来源移动或被替换后拒绝过期管理入口。
- Windows 便携启动器支持长路径和有界清理重试，正常退出后清理提取目录；安装版卸载保留用户数据。

### 安装

- Windows x64 安装版：`Nook-Setup-0.1.0-alpha.1-x64.exe`；便携版：`Nook-Portable-0.1.0-alpha.1-x64.exe`。发布时附对应源码、验证记录和 `SHA256SUMS.txt`。
- 首次启动在「设置 → 模型连接」中配置服务地址、凭据及模型；迁移已有工作台前可导出完整备份。
- 当前候选未签名。其他平台、原生语音／OCR、媒体生成、远程同步和离线模型下载管理尚未提供。完整设计参考、物理系统交互与真实服务的验收范围见项目文档。

### English

Single-line form fields and selects use 32px controls with inset outlines and distinct keyboard, open and invalid states. Buttons retain their exact content gutters without an extra border. Compact model and tool selectors remain separate from ordinary forms. Quick Chat keeps its compact conversation selector so the model controls remain reachable in small zoomed windows. Settings search removes the duplicate inner rectangular outline while retaining its outer border and keyboard focus ring.

Code blocks adopt the current themed surface, 8px corners, content padding and relative typography. Copying announces success, retains source for retry on failure and prevents duplicate pending writes. Code and tool text share stale-completion protection while retaining wrapping and isolated diagrams.

Project analysis and execution can record up to twenty conversation task steps. Invalid updates retain the last valid record; stopping marks unfinished work as awaiting continuation. Exact tool records and unsent drafts survive restart. Recording does not execute steps or create project plan files. Bounded worktree identity queries and concurrent read-only snapshot metadata queries retain all deletion rechecks and sequential removal.

Nook is a local AI workspace for multi-provider chat, model comparison, conversation branches, context summaries, document retrieval, original PDF reading, code editing, Git, terminals, HTML previews and local extensions. Slash choices for templates, assistants and projects work in both the workbench and Quick Chat without sending a message.

Local branches can be renamed without replacing existing refs. Merged-only deletion protects the current branch, worktrees and commits absent from the current version, while retaining files, drafts and remote refs.

Six settings forms protect unsaved changes with a compact confirmation. Continue editing is the safe default; Enter and Escape retain drafts, and failed saves preserve input for retry.

Memory deletion defaults to Cancel, blocks dismissal while pending and retains entries on failure. Its default typography, top placement and translucent surface are corrected; long content scrolls independently while action controls remain visible.

Shared buttons use the current default dimensions while preserving compact attachment and search controls. Keyboard focus and disabled saving are independently verified.

Worktrees support explicit registration, local pinning, private snapshots, restoration to a new directory and snapshot-before-delete cleanup. Optional post-create cleanup protects active, pinned, registered and modified trees. Credentials remain encrypted locally, shared backups exclude secrets, previews and plugins stay isolated, and original open-source notices are retained.

This candidate fixes delayed final command output, selection restoration, draft persistence, streaming races, restore locking, keyboard focus and Windows portable cleanup. Windows x64 installer and portable files are unsigned; uninstalling preserves user data. Additional platforms and the remaining documented reference-design and physical-system checks are separate from this candidate.

The composer uses the current default corner radius and a smaller light shadow in compact CSS viewports, retaining its input, sending, draft and keyboard behavior.

## 开发记录

详细实现与验证见[开发记录](docs/VALIDATION-HISTORY.md)。整理前的更新记录[原文保留](docs/CHANGELOG-HISTORY-2026-10-13-COMMAND-PROGRESS.txt)，其中各历史构建的失败现场和验收范围继续有效。
