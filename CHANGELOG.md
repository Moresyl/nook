# 更新记录

## 未发布

设置侧栏增加搜索，可定位九个分类和实际设置字段；支持输入法、方向键、首尾选择、Enter 定位、Ctrl F 聚焦及 Escape 清空。切换分类保留已打开表单的未保存内容，搜索不读取连接密钥和配置值。初始聚焦与下方开关定位的边框裁切已修正。六项源码原生专项和 18 张明暗缩放原图核验通过；新增应用体的完整安装及分发回归仍待重验，发布门槛增加至至少 361 项。

当前候选增加工作树集中管理、显式项目登记、本机固定状态、私有快照、恢复到新目录、安全删除和创建后自动清理。源码验证通过，完整参考页面与分发仍在验收，尚未发布版本；界面采用范围见 [设计对照](docs/DESIGN-ALIGNMENT.md)，验证进度见 [发布状态](docs/RELEASE.md)。

快速聊天草稿及继续已有聊天的保存接入绑定原文件版本的小型检查点，减少大历史工作区的整文件替换；保留完整前一版本备份、独立草稿与重启恢复。结构改变、原文件被替换或检查点达到原有 8 MB 上限时仍完整保存。当前完整单元、安装与未安装的各 355 项回归、便携及保留数据卸载通过；托管发布尚未完成。

工作树固定操作结束后改为等待控件恢复可用再回焦，并滚动完整操作区域。原有错误回焦专项与完整包内回归通过；两种主题和三档缩放的 21 张原图已逐张复核。

## [0.1.0-alpha.1] - 2026-10-11

Nook 首次独立预发布的候选说明。独立仓库目前没有已发布版本。

### 新功能

- **对话与模型**：连接 Responses、OpenAI 兼容、Anthropic、Gemini、Azure 和 Ollama。支持流式回复、停止与重试、回复版本、消息编辑、分支排序、独立草稿，以及同一问题的 2–4 模型比较。
- **上下文与工具**：生成、编辑和选择上下文摘要，完整原文继续保存；原文变化时恢复完整历史。工具记录展示状态、耗时和操作摘要，支持展开、复制与失败重试。主工作台和快速聊天共用相应能力。
- **资料阅读**：提取 PDF、Office、OpenDocument 与文本，输入图片，管理资料集和关键词／向量／混合检索。保留 PDF 原件，支持离线版式阅读、目录、查找、原字节导出和备份恢复；MCP PDF 可显式加入聊天。
- **项目工作台**：分页文件树、代码编辑、草稿、Git 审阅／暂存／提交、分支创建与切换、真实终端，以及当前 HTML 草稿的独立或并排预览。
- **工作树管理**：从新分支或未占用的本地分支创建独立工作树，固定选定提交并保留源仓库改动；设置默认根目录、可选创建前获取上游，获取失败仍保留本地创建。集中列表支持分页、关联会话、新建项目聊天和显式「添加为项目」；登记失败保留名称与同一 ID 重试，重复登记保留已有记录。
- **助手与扩展**：助手配置、变量提示模板、显式记忆、自动任务、MCP 工具／资源／提示与 OAuth、本地技能和隔离插件。临时浏览器支持独立标签、历史及键盘导航。
- **本地备份**：导出 JSON 或 gzip 工作台，保留普通聊天、附件、资料库、草稿和本地扩展资产；恢复后插件需要重新授权。临时聊天不写入持久历史或完整备份。

### 变更与安全

- 应用名称、图标和 Windows 产品信息统一为 **Nook**，兼容读取已有数据。清理旧产品标识，保留原始开源许可证、依赖及安装组件来源说明。
- 密钥本地加密并绑定连接目标，共享备份不含密钥。插件按能力与项目范围授权，文件修改、命令和远程工具展示具体操作。
- 网页、预览与插件使用隔离边界；外部网页不能访问工作台桥接或 Node。MCP 文件限制大小和数量，预览或导出不会自动调用模型。
- 工作树登记重新核实实际 Git 归属、来源与规范路径；拒绝过期入口，保留已有项目数据。外部工作树不会因登记获得自动清理权限。
- 应用实际创建的工作树单独保留本机创建记录，支持固定与取消固定；目录被移动或替换时拒绝旧记录。创建记录和固定状态不进入共享备份，保存失败保留文件及旧状态。
- 本机工作树可保存私有快照，保留提交、暂存区、普通文件和忽略文件，并恢复到尚不存在的新目录；不覆盖原工作树。拒绝损坏快照、链接和不支持的索引状态，共享备份不包含私有快照；退出等待已接受的快照与清理操作完成。
- 安全删除先持久保存可恢复快照，保留源仓库与分支；固定、已登记、关联固定聊天、运行回复／终端、草稿、锁定与含改动目录均受保护，外部与身份变化目录无删除权限。自动清理默认关闭，创建后按 1～50 的保留数量处理合格旧树，停用需要确认；快照无法保存或达到 100 份上限时停止清理。

### 修复与完善

- 统一明暗主题、Inter 字体、共享控件、工具提示与键盘焦点；调整输入区展开、长模型名称省略、窄窗口导航，以及设置分类和内容独立滚动。尚未达到全部参考界面 100% 还原。
- 修复草稿保存、分支导航及多路流式检查点的竞争，保留失败后的输入、原文和重试能力；损坏的恢复资料保留并显示可恢复错误。
- 修复恢复等待期间设置仍可关闭或切换的问题，释放重载后旧预览和浏览器视图，保留独立草稿与资源原件。
- 修正工作树聊天操作及上游开关的焦点边框；键盘检查等待实际异步列表就绪，保留原有断言与期限。登记验证覆盖保存失败后同 ID 重试、来源变更、备份恢复和六种主题／缩放。
- Windows 便携启动器支持长路径和有界清理重试，正常退出后清理提取目录；安装版卸载保留用户数据。

### 安装

- 计划提供 Windows x64 安装版 `Nook-Setup-0.1.0-alpha.1-x64.exe` 和便携版 `Nook-Portable-0.1.0-alpha.1-x64.exe`；当前分发与托管发布尚未验收完成。
- 正式提供文件时附对应源码、验证记录和 `SHA256SUMS.txt`。首次启动自行配置模型连接；迁移已有工作台前可导出完整备份。
- 候选可执行文件未签名。其他平台、原生语音／OCR、媒体生成、远程同步和离线模型下载管理尚未提供；当前安装／便携验收与全部参考页面仍在进行。

### English

Nook is a local AI workspace with multi-provider chat, model comparison, conversation branches, context summaries, document retrieval, original PDF reading, code editing, Git, terminals, HTML previews and local extensions. Worktree settings add a managed root, optional upstream fetching, linked conversations and explicit project registration with same-ID retry and duplicate preservation.

The candidate includes fixes for draft persistence, parallel streaming, restore locking, preview lifecycle, keyboard focus and Windows portable cleanup. Credentials stay encrypted locally, previews and plugins remain isolated, and original open-source notices are retained.

Worktrees support private snapshots, restoration to a new directory and snapshot-before-delete cleanup with pinned-chat, active-terminal, dirty-tree and directory-identity protection. Optional post-create cleanup retains a configurable 1–50 recent trees and requires confirmation to disable.

The first Windows x64 prerelease has not been published. Current distribution verification, hosted CI and full reference-design adoption remain incomplete. Detailed historical evidence is preserved in [development records](docs/VALIDATION-HISTORY.md).
