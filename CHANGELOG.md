# 更新记录

## 未发布

当前 Windows 候选已完成本机分发验收；原托管发布与完整参考界面仍待完成。[发布状态](docs/RELEASE.md) · [设计对照](docs/DESIGN-ALIGNMENT.md)

## [0.1.0-alpha.1] - 2026-10-13

Nook 是一个本地 AI 工作台，用于对话、资料阅读和项目开发。首个 Windows x64 预发布候选，尚未发布。

### 新功能

- **对话与模型**：连接 Responses、OpenAI 兼容接口、Anthropic、Gemini、Azure 和 Ollama；支持流式回复、停止与重试、回复版本、消息编辑、对话分支，以及同一问题的 2–4 模型比较。
- **快捷选择**：主工作台和快速聊天输入 `/` 可查找模板、助手和项目。支持键盘选择和光标处插入变量模板；取消保留原文，选择不会发送消息。
- **上下文与工具**：生成、编辑并选用上下文摘要，继续保留完整原文；原文变化后恢复完整历史。工具记录展示状态、耗时和操作摘要，可展开、复制及失败重试。
- **资料阅读**：导入文档、文本和图片，管理关键词／向量／混合检索资料集。PDF 保留原件，支持离线阅读、目录、查找、原字节导出、备份恢复和显式加入聊天。
- **项目工作台**：分页文件树、代码编辑与草稿、Git 审阅／暂存／提交、本地分支创建与切换、真实终端，以及 HTML 草稿的独立或并排预览。
- **独立工作树**：从新分支或未占用的本地分支创建工作树，保留源仓库改动。支持默认根目录、可选获取上游、关联会话、项目登记、本机固定、私有快照和恢复到新目录；获取或登记失败保留可重试状态。
- **助手与扩展**：助手、变量提示模板、显式记忆、自动任务、MCP 工具／资源／提示与 OAuth、本地技能和隔离插件；临时浏览器提供独立标签及键盘导航。
- **本地备份**：导出 JSON 或 gzip 工作台，保留普通聊天、附件、资料库、草稿和扩展资产。恢复后插件需要重新授权，临时聊天不进入持久历史或完整备份。

### 变更与安全

- 名称、图标和 Windows 产品信息统一为 **Nook**，兼容读取已有数据；保留原始开源许可证、依赖和安装组件来源说明。
- 密钥本地加密并绑定连接目标，共享备份不含密钥。插件按能力和项目范围授权；文件修改、命令及远程工具展示具体操作。
- 网页、预览和插件保持隔离，外部网页无法使用工作台桥接或 Node；预览、导出不会自动调用模型。
- 工作树登记重新核对 Git 归属、来源及规范路径。外部工作树不会因登记获得自动清理权限，本机管理记录和私有快照不进入共享备份。
- 删除前保存可恢复快照，保护源仓库、分支、固定／已登记项目、固定聊天、运行中的回复或终端、草稿及含改动目录。恢复仅写入尚不存在的新目录。
- 创建后自动清理默认关闭，可保留 1–50 个合格的最近工作树；停用需确认。快照保存失败或达到原有上限时停止清理，退出等待已接受的保存与清理操作。

### 修复与完善

- 修复连续命令输出的最后一段可能等到下一段或进程结束才显示的问题，保留 100 毫秒通知节奏及关闭、报错、取消后的清理。
- 修复选择助手或项目后的光标恢复覆盖用户新选区，导致后续输入重复前缀的问题。
- 修复编辑器文件标签和关闭按钮的键盘焦点圈被横向滚动条裁切的问题；工作树刷新及设置保存完成后保留正确焦点，用户已切换控件时不抢焦点。
- 设置支持分类和字段搜索，切换分类保留未保存草稿；统一明暗主题、共享控件、文字提示和窄窗口导航。
- 修复草稿保存、分支导航、多路流式检查点和恢复等待的竞争；保存失败保留输入、原文与重试能力，恢复异常保留原资料。
- 工作树逐项目显示结果、等待和脱敏错误；管理记录加载期间禁用写操作，来源移动或被替换后拒绝过期管理入口。
- Windows 便携启动器支持长路径和有界清理重试，正常退出后清理提取目录；安装版卸载保留用户数据。

### 安装

- Windows x64 安装版：`Nook-Setup-0.1.0-alpha.1-x64.exe`；便携版：`Nook-Portable-0.1.0-alpha.1-x64.exe`。发布时附对应源码、验证记录和 `SHA256SUMS.txt`。
- 首次启动在「设置 → 模型连接」中配置服务地址、凭据及模型；迁移已有工作台前可导出完整备份。
- 当前候选未签名。其他平台、原生语音／OCR、媒体生成、远程同步和离线模型下载管理尚未提供。完整设计参考、物理系统交互与真实服务的验收范围见项目文档。

### English

Nook is a local AI workspace for multi-provider chat, model comparison, conversation branches, context summaries, document retrieval, original PDF reading, code editing, Git, terminals, HTML previews and local extensions. Slash choices for templates, assistants and projects work in both the workbench and Quick Chat without sending a message.

Worktrees support explicit registration, local pinning, private snapshots, restoration to a new directory and snapshot-before-delete cleanup. Optional post-create cleanup protects active, pinned, registered and modified trees. Credentials remain encrypted locally, shared backups exclude secrets, previews and plugins stay isolated, and original open-source notices are retained.

This candidate fixes delayed final command output, selection restoration, draft persistence, streaming races, restore locking, keyboard focus and Windows portable cleanup. Windows x64 installer and portable files are unsigned; uninstalling preserves user data. Additional platforms and the remaining documented reference-design and physical-system checks are separate from this candidate.

## 开发记录

详细实现与验证见[开发记录](docs/VALIDATION-HISTORY.md)。整理前的更新记录[原文保留](docs/CHANGELOG-HISTORY-2026-10-13-COMMAND-PROGRESS.txt)，其中各历史构建的失败现场和验收范围继续有效。
