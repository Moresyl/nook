# 更新记录

## 未发布

输入框依据当前主题覆盖采用 22px 默认圆角，CSS 视口小于 40rem 时缩小浅色大阴影。新类型、构建和 13 项首页原生检查通过，两次正常退出、13 张原图逐张复核；本机实际系统缩放为 100%，三档应用缩放、设置键盘回焦和草稿重启保留通过。新应用体的完整分发尚待验收，原托管流水线仍受账户付款／额度限制。

The composer now uses the current 22px default radius and a smaller light shadow below a 40rem CSS viewport. Fresh type checks, build and thirteen homepage checks pass, with two normal exits and thirteen individually reviewed captures. This host's physical display scale is 100%; full distribution of the new body and hosted publication remain separate.

当前输入框应用体完成 375 项完整源码桌面回归、74 次正常退出，最长 1,712ms，无强制结束；39 份新报告、617 张原图及准确编译文件归档。旧 24px 测试期望的首轮失败现场保留，只修正为实际 22px 后重跑通过。发布状态和界面验收说明整理为当前状态页，旧中英文记录逐字保留并链接；没有取消验收要求或宣称新包已经通过。

The current composer body passes 375 complete source desktop checks with 74 normal exits and no forced termination. Reports, 617 original captures and exact compiled files are archived; captures have not all been visually reviewed. The obsolete radius assertion's initial failure is preserved. Release and UI notes now separate current status from byte-preserved history; packaged and installed validation remain pending.

原生文件树测试明确初始化其尺寸断言要求的 100% 缩放，避免受已有缩放状态影响。原有超时和断言保留，此前失败现场归档；七组专项通过，源码、新包和实际安装各通过 375 项／74 次正常退出，无强制结束。

Native file-tree tests initialize the 100% zoom required by their viewport assertions. Original timeouts and assertions remain. Seven focused checks pass; source, packaged and installed runtimes each pass 375 checks with 74 normal exits. The failed scene is retained.

记忆删除弹窗进一步修正默认标题的字重与字距，采用顶部定位、半透明表面、细边缘与背景模糊。长内容仍有界滚动，关闭控件保持可见。1,557 项完整单元、类型、构建和五组原生专项通过；源码、新包与安装各通过 375 项／74 次正常退出，各保留 39 份报告、617 张原图和 236 个匹配编译文件。源码专项、包内与安装的记忆原图各 22 张逐张复核；原分发、便携、保留数据卸载及十一份运行记录通过。此前候选与失败证据保留，完整参考界面与托管发布未完成。

The memory deletion dialog now uses the default title typography, top placement, translucent surface, thin ring and backdrop blur. All 1,557 unit tests, type checks, build and five native checks pass. Source, packaged and installed runtimes each pass 375 checks with 74 normal exits, retaining 39 reports, 617 captures and 236 matching compiled files. Each memory-image set has 22 individually reviewed captures. Distribution, portable execution, data-preserving uninstall and eleven matching runtime records pass; complete reference adoption and hosted publication remain unfinished.

记忆删除确认采用 520px 上限与长内容独立滚动，默认聚焦取消。删除等待期间禁止关闭，失败保留内容并提供重试。五组专项、六种主题／应用缩放及本轮三批记忆原图复核通过；源码、新包与实际安装的完整回归和分发验收通过。

Memory deletion now defaults to Cancel, keeps long content scrollable and prevents dismissal while deleting. Failures retain the entry for retry. Five native checks, six theme/zoom layouts, three reviewed memory-image sets and complete source, packaged and installed distribution gates pass.

新增设置草稿保护：模型连接、桌面快捷键、工作树、MCP、插件权限和记忆在离开未保存表单前显示确认。默认继续编辑，回车或 Escape 保留输入；切换分类保留草稿，明确放弃后才执行离开操作。保存等待期间禁止重复操作，失败保留输入供重试。

确认框采用紧凑布局，适配明暗主题及窄窗口。类型检查、1,555 项单元测试、构建和八组设置专项通过；完整源码、新包与安装各通过 373 项／74 次正常退出，原五个分发专项、便携七项、保留数据卸载与十一份运行记录通过。源码专项、包内和安装各 34 张设置原图逐张复核；安装轮先前七张缩放差异的判断经原图像素测量更正，三档缩放尺寸一致，原记录保留。此前候选及失败证据保留，原托管发布与完整参考界面未完成。[发布状态](docs/RELEASE.md) · [设计对照](docs/DESIGN-ALIGNMENT.md)

Settings now protect unsaved drafts in six forms. Continue editing is the safe default; saving blocks duplicate actions and failures retain input. Type checks, 1,555 unit tests, the build and eight focused checks pass. Source, packaged and installed runtimes each pass 373 checks with normal exits; original distribution, portable and data-preserving uninstall gates pass. Pixel measurements corrected seven earlier visual judgments: the unchanged installed captures match all three requested zoom levels. Hosted release and complete UI adoption remain pending.

## [0.1.0-alpha.1] - 2026-10-13

Nook 是一个本地 AI 工作台，用于对话、资料阅读和项目开发。首个 Windows x64 预发布候选，尚未发布。

### 新功能

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

- 全局搜索采用 520px 宽度上限和随窗口收缩的布局，明暗表面与居中定位单独适配；键盘移到列表末项时保留滚动留白。
- 输入框采用当前主题的 22px 默认圆角，窄视口收紧浅色阴影，保留原有输入、发送、草稿和键盘行为。
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

Nook is a local AI workspace for multi-provider chat, model comparison, conversation branches, context summaries, document retrieval, original PDF reading, code editing, Git, terminals, HTML previews and local extensions. Slash choices for templates, assistants and projects work in both the workbench and Quick Chat without sending a message.

Local branches can be renamed without replacing existing refs. Merged-only deletion protects the current branch, worktrees and commits absent from the current version, while retaining files, drafts and remote refs.

Six settings forms protect unsaved changes with a compact confirmation. Continue editing is the safe default; Enter and Escape retain drafts, and failed saves preserve input for retry.

Memory deletion defaults to Cancel, blocks dismissal while pending and retains entries on failure. Its default typography, top placement and translucent surface are corrected; long content scrolls independently while action controls remain visible.

Worktrees support explicit registration, local pinning, private snapshots, restoration to a new directory and snapshot-before-delete cleanup. Optional post-create cleanup protects active, pinned, registered and modified trees. Credentials remain encrypted locally, shared backups exclude secrets, previews and plugins stay isolated, and original open-source notices are retained.

This candidate fixes delayed final command output, selection restoration, draft persistence, streaming races, restore locking, keyboard focus and Windows portable cleanup. Windows x64 installer and portable files are unsigned; uninstalling preserves user data. Additional platforms and the remaining documented reference-design and physical-system checks are separate from this candidate.

The composer uses the current default corner radius and a smaller light shadow in compact CSS viewports, retaining its input, sending, draft and keyboard behavior.

## 开发记录

详细实现与验证见[开发记录](docs/VALIDATION-HISTORY.md)。整理前的更新记录[原文保留](docs/CHANGELOG-HISTORY-2026-10-13-COMMAND-PROGRESS.txt)，其中各历史构建的失败现场和验收范围继续有效。
