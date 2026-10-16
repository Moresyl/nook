# 更新记录

## 未发布

- 普通工具提示采用明暗专用颜色、16px 圆角、5px／12px 内距、18px 行高与 430 字重，优先在控件上方以 2px 间距显示，边缘自动翻转；修复预览工具栏覆盖提示字重与换行的问题，长中文路径完整显示。
- 提示样式源码 `8b1c140` 通过 406 项完整桌面检查、75 次正常退出，最长 3364ms，无强制结束；独立文字提示 7 项、控件 4 项专项通过，明暗主题和 100／125／150% 缩放保留键盘、草稿与文件原文。类型、构建及 137 文件／1617 项单元通过，1046 个源码输入与 236 个编译文件一致；14 张提示专项、5 张控件专项及 5 张完整回归代表图逐张查看。安装、分发和完整设计对照仍待完成。[提示样式验收](verification/tooltip-validation-review-result.json)
- 明暗主题采用对应的默认正文前景色；共享按钮悬停底色分别采用前景 5%／白色 8%。行内代码使用中性混色背景，保留标题、粗体、斜体与链接的文字样式。
- 主题与行内样式源码候选 `50bb4c1` 通过 406 项完整桌面检查、75 次正常退出，最长 3737ms，无强制结束。保留 40 份报告、813 张原图、1046 个源码输入与 236 个编译文件；32 张专项行内原图和 4 张本轮完整回归代表图逐张查看。类型、构建和 137 文件／1617 项单元通过；后续只调整原生剪贴板诊断文案，由最终桌面回归执行验证。安装、分发与全部设计对照仍待完成。[主题样式验收](verification/inline-markdown-validation-review-result.json)
- 字号与代码表面源码候选 `8f62d89` 通过 404 项完整桌面检查、75 次正常退出，最长 1928ms，无强制结束；137 文件／1617 项单元、类型与构建通过。保留 40 份报告、781 张原图、1046 个源码输入与 236 个编译文件；4 张专项和 4 张完整回归代表图逐张查看，全部原图未全部视觉复核。新候选安装、分发及全部参考页面仍待验收。[字号表面验收](verification/markdown-font-validation-review-result.json)
- 表格字号采用独立代码字号与正文相对字号的较大值，正文缩小时保留表格阅读下限；行内代码随所在段落或标题缩放，背景在换行处连续，混合方向文字保持隔离。
- 普通代码块默认 12px、行高至少 20px，采用 20px 圆角与柔和角形、48px 标题栏和 36px 操作按钮；正文内距按窗口宽度调整，复制与自动换行保留原文。
- 主对话正文上限对齐为 48rem，助手消息的长表格根据可用聊天宽度展开；窄窗口保持滚动边界，快速聊天与窄表格保留正文宽度。消息导航随正文容器对齐，复制、预览与保存原文保留。
- 正文宽度源码候选 `c708330` 完整通过 402 项／75 次正常退出，最长 1664ms，无强制结束；137 文件／1617 项单元、类型与构建通过。保留 40 份报告、733 张原图、1046 个源码输入、236 个编译文件及完整性已验证用户目录归档；4 张专项和 4 张完整回归代表图逐张查看，全部原图未全部视觉复核。新候选安装、分发与完整设计对照仍待完成。[宽度验收](verification/thread-width-validation-review-result.json)
- 新增独立对话／代码字号设置，支持搜索、保存、重新加载和恢复默认；主工作台与快速聊天共用偏好，旧配置、原消息和控件字号保留。
- 上一字号源码候选 `945e8b6` 完整通过 400 项／75 次正常退出，最长 1821ms，无强制结束；137 文件／1616 项单元、类型与构建通过。保留 40 份报告、727 张原图、1046 个源码输入、236 个编译文件及完整性已验证用户目录归档；4 张专项与 4 张完整回归代表图逐张查看，全部原图未全部视觉复核。该轮不代替正文宽度候选或新分发验收。[字号验收](verification/chat-font-validation-review-result.json)
- 表格复制按钮支持左右方向键即时滚动 40px，保留焦点和组合键原行为；横向溢出按滚动位置显示边缘渐隐，无溢出时取消额外滚动入口，强制颜色模式保留完整内容。纯数字单元格不换行，表格与每个单元格分别采用自动文字方向，复制的 HTML 保留这一语义。
- 表格复制同时提供精确 Markdown 和语义 HTML，保留 Windows 换行、对齐、强调及单份 TeX 原文，移除主题样式和不安全资源。主工作台与快速聊天验证实际系统剪贴板及全部原有 MIME 内容逐字节恢复；富文本写入被拒绝时保留失败与重试，旧原文的成功／失败和卸载后的完成不会影响新内容。
- 前一表格布局候选 `615a8f1`（界面改动 `2cab749`）完整通过 396 项／75 次正常退出，最长 1731ms，无强制结束；137 文件／1614 项单元通过。保存 40 份报告、711 张原图、1043 个源码输入、236 个编译文件及完整性已验证用户目录归档；6 张专项与 6 张完整回归代表图逐张查看，全部原图未全部视觉复核。类型、构建与覆盖相关输入匹配；Windows 空文本剪贴板恢复夹具已修正并增加真实往返检查，四个失败现场保留。该轮证据不代替字号候选或新分发验收。[表格布局证据](verification/table-layout-validation-review-result.json)
- 上一候选 `e4f8bb9` 完整通过 394 项／75 次正常退出，最长 4841ms，无强制结束；137 文件／1612 项单元通过。保存 40 份报告、709 张原图、1043 个源码输入、236 个编译文件和完整性已验证用户目录归档；4 张专项及 4 张完整回归代表图逐张查看，全部 709 张未全部视觉复核。该轮证据不替代当前候选。[表格复制证据](verification/table-copy-validation-review-result.json)
- 正文按参考层级调整标题、列表、引用与段落间距；可见汉字段落采用专用间距，嵌套强调、链接和行内代码保留语义。正文保持 14px 默认字号，行高为 1.625；参考实际运行字号和完整字体尚未对齐。
- 表格保留原生语义、列对齐及可读宽度；溢出区域支持键盘滚动和居中展开，预览随内容收缩，Escape 返回展开按钮。复制保留流式及已保存表格的精确 Markdown 和 Windows 换行，支持成功反馈、失败重试与等待锁定，提示和预览不进入正文查找。
- 正文候选 `e3b5f0e` 完整回归通过 390 项／75 次正常退出，最长 3653ms，无强制结束；保存 40 份报告、709 张原图、1040 个源码／夹具输入和 236 个编译文件。136 文件／1605 项单元通过，358 个覆盖／测试／渲染器／配置输入与覆盖率运行逐字节一致。12 张专项与 4 张完整回归代表原图逐张查看；全部 709 张未全部视觉复核，新候选分发与完整参考对照仍待完成。[本轮证据](verification/prose-layout-validation-review-result.json)
- 普通右对齐用户消息采用 70% 宽度上限、22px 圆角、10px／16px 内距与主题前景 5% 混色；主工作台和快速聊天保留中文换行、长原文与附件。旧构建的 82% 差异先在原生检查中复现，再验证新布局。
- 用户消息轮次源码候选完整回归通过 387 项／75 次正常退出，保存 40 份报告、667 张原图和完整性已验证的用户目录归档。28 张专项新图与 8 张完整回归代表图逐张复核；全部 667 张原图未全部视觉复核。该轮证据保留，不替代本轮正文验收。
- 资源退订原生检查等待页面完成退订与读取后再保存预览快照，保留精确原文、晚到通知和事件数断言；第一次完整运行的 237 项后失败记录与后续重跑分别保存。
- 新增会话任务步骤：保留最新有效记录和工具原文；无效更新保留旧记录，停止后待继续，重启保留草稿。
- 共享按钮采用 24px／8px／4px 与 13px 字号；普通单行表单采用 32px 高、8px 圆角、12px 内距和内描边。聊天输入区保留 22px 外圆角与窄视口浅色阴影。
- 工作树只读身份查询按四项一批执行，独立 Git 元数据读取并行等待；删除仍串行，原文件、索引与删除前复查保留。
- 发布与安装门槛提高为 383 项，严格验证八组任务步骤行为、十二种布局、逐项可读边界和十六张完整捕获。原期限与覆盖率门槛保持不变。
- 设置搜索保留外层焦点圈，去除内层重复矩形描边；快速聊天标题保持 22px 紧凑高度，避免小窗口高缩放挤出模型操作。
- 代码块采用当前明暗代码表面和独立代码字号。复制提供成功／失败反馈，等待时禁止重复写入；代码和工具原文共用异步版本保护，原文改变或组件关闭后不接受旧完成状态。
- 聊天正文查找排除代码复制的成功和失败提示，继续保留真实代码内容与精确高亮。
- 富文本轮次应用体 `fa11763` 的新类型检查、构建，以及源码、新包和实际安装各 386 项／75 次正常退出通过。完整 136 文件／1,602 项单元运行的 278 个覆盖、测试、依赖及配置输入保持一致，渲染器复制和搜索另由原生套件验证。原五项分发专项、十一份匹配记录和保留数据卸载通过。源码 12 张代表原图逐张查看，包内与安装各 8 张新图逐张查看及 4 张与源码原图完全一致；分发控件 26 张／文字提示 12 张全部逐张查看，每轮 633 张完整原图未全部视觉复核。
- 精简发布、能力和设计说明，完整保留许可证、旧轮次、原始截图和失败证据。完整参考界面、物理交互与托管发布尚未完成。

Tables copy exact Markdown and semantic HTML together, retaining alignment, emphasis and a single TeX source while excluding theme styles and unsafe resources. Main and Quick Chat verify physical Windows clipboard readback and byte-for-byte restoration of all original MIME payloads. Rejected writes stay retryable and stale completions are ignored. The current source passes 394 native checks with 75 normal exits and 1,612 unit tests; current distribution acceptance remains pending.

Prose headings, lists, quotes and Han-text paragraph spacing follow the reference hierarchy. Tables retain keyboard-scrollable previews that fit their content and return focus on Escape. The previous prose candidate passed 390 native checks with 75 normal exits and 1,605 unit tests.

Task records retain valid steps, exact tool history and unsent drafts across restart. Code and tool copying share stale-completion protection, and copy feedback stays outside body search. The previous rich-content candidate passed 386 checks with 75 normal exits in source, unpacked and installed runtimes, alongside the original distribution and data-preserving uninstall gates. Complete reference parity and hosted publication remain pending.

[发布状态](docs/RELEASE.md) · [原文历史](docs/CHANGELOG-HISTORY-2026-10-14.txt)，历史 SHA-256：`5734f75f345be6cfbb3933243992cdd1f18580313bcb3b926c891d46531fe854`。

## [0.1.0-alpha.1]

Nook 是一个本地 AI 工作台，用于对话、资料阅读和项目开发。首个 Windows x64 预发布候选，尚未发布。

### 新功能

- 主对话正文上限为 48rem，长表格按可用聊天宽度自适应展开；快速聊天与窄表格保持正文宽度，窄屏和缩放保留横向滚动边界、复制、预览及原消息。
- 新增独立对话／代码字号设置，支持搜索定位、键盘操作、保存后重新加载与恢复默认。主工作台和快速聊天使用同一偏好，界面控件和项目编辑器／终端保持各自字号；旧配置与消息原文保留。
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

- 对齐默认正文与悬停颜色；行内代码背景随主题混色，嵌套在粗体、斜体、标题和链接中时保留原有文字样式。
- 表格文字保留独立代码字号下限，调整对话文字时不会缩成难以阅读的小字；行内代码随段落和标题缩放，长内容换行保留连续背景与文字方向。
- 普通代码块默认 12px、行高至少 20px，改用 20px 圆角、48px 标题栏和 36px 操作按钮，宽窗口增加正文内距。
- 正文完善标题、列表、引用与汉字段落间距；普通用户消息采用 70% 宽度上限及 22px 圆角，主工作台和快速聊天保留长文与附件阅读。
- 表格一次复制精确 Markdown 与语义 HTML，保留 Windows 换行、对齐、强调和单份 TeX 原文；过滤不安全资源，写入失败支持重试，原文变化后忽略旧完成反馈。溢出表格支持键盘滚动、边缘渐隐和随内容收缩的展开预览，Escape 返回焦点；纯数字不换行，混合方向单元格分别自动排版。
- 普通单行表单和下拉框采用 32px 高、8px 圆角、12px 内边距与 13px 字号，分别保留输入聚焦、下拉展开、键盘圈和非法状态。按钮取消额外实体边框，统一默认 400 字重与 150ms 过渡；模型和工具下拉使用紧凑规格。
- 快速聊天的会话标题保留 22px 紧凑高度，修复普通表单尺寸继承导致小窗口高缩放时模型操作区被挤出的情况。
- 设置搜索移除内层输入的重复矩形描边，保留外层搜索框的描边和键盘焦点圈，覆盖默认、悬停与聚焦状态。
- 代码块保留主题表面、独立滚动、精确原文、自动换行和隔离图表。复制成功明确提示，失败保留原文供重试，等待期间防止重复写入；流式原文变化后拒绝旧复制反馈。

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

Default text and action-hover colors follow their light/dark semantic roles. Inline code uses a neutral blended background while retaining heading, bold, italic and link styling.

Nook brings multi-provider chat, model comparison, conversation branches, document retrieval, original PDF reading, project tools and local extensions into one workspace. Slash choices insert templates, assistants and projects without sending a message. Conversation task steps retain valid records and drafts across restart; they do not execute the plan themselves.

Conversation and code font sizes can be saved independently, found through settings search and reset to their defaults. Main and quick chat share the preference while controls, project editors and terminals retain their own typography.

Tables use the larger of the code-size floor and relative prose size. Inline code follows paragraph and heading sizes with continuous wrapping backgrounds. Code blocks default to 12px with a 20px minimum line height, a 20px corner radius, a 48px header and larger actions; horizontal padding adapts to the window width.

Main conversation text is capped at 48rem. Long tables expand within the available chat panel, while quick chat and narrow tables retain the prose width. Native light/dark and zoom checks preserve scrolling, copying, preview focus and original messages.

Prose and message layouts refine spacing and long-content reading. Tables copy exact Markdown and semantic HTML, preserve line endings, alignment and original TeX, filter unsafe resources, and reject stale completions. Keyboard scrolling, directional fades, numeric nonwrapping and independent cell direction support wide and mixed-language tables. Forms, compact selectors, code blocks, search focus and the composer adopt their corresponding theme and layout specifications.

Unsaved settings and failed operations retain drafts for retry. Worktree registration, pinning, private snapshots, restoration and optional cleanup protect active or modified directories. Credentials stay encrypted locally, shared backups exclude secrets, and previews and plugins remain isolated. This candidate fixes delayed command output, selection restoration, streaming races, restore locking, keyboard focus and portable cleanup.

Windows x64 installer and portable candidates are unsigned; uninstalling preserves user data. Original open-source notices remain included. Release, complete reference parity, other platforms and the remaining documented physical-system checks are still pending.

## 开发记录

详细实现与验证见[开发记录](docs/VALIDATION-HISTORY.md)。整理前的更新记录[原文保留](docs/CHANGELOG-HISTORY-2026-10-13-COMMAND-PROGRESS.txt)，其中各历史构建的失败现场和验收范围继续有效。
