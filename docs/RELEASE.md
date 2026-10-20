# Nook 发布状态

Windows x64 候选版本 **0.1.0-alpha.1**，尚未发布。Nook 是用于对话、资料阅读和项目开发的本地 AI 工作台。

## 本轮更新

- 文件树启用虚拟滚动，保留分页、错误重试、祖先目录与跨视口键盘导航；千文件目录无需同时挂载全部条目。
- 文件树增加悬停淡显与键盘焦点父目录引导线，支持减少动画；极矮视口仍保持引导线与行对齐。
- 文件树改用单图标和紧凑缩进，移除八级缩进上限，深层目录继续区分层级。
- 预览分栏增加细渐变指示线、内侧焦点框、双击均分和拖动取消回滚；预览会话与草稿在拖动前后保留。
- 文件树滚动时保留展开的祖先目录，在子树末尾推离；键盘定位避开固定目录，矮窗口下编辑器空态说明保持可读。
- 紧凑侧栏的会话和操作按钮分开布局，修复高缩放时操作按钮拦截会话点击的问题。
- 文件树支持直接键入文件名前缀定位，重复首字母循环查找，自动滚动显示焦点。定位不会打开文件；输入法组词与确认键受到保护。
- 会话重命名共用同一对话框，固定操作目标，保存失败保留输入并回焦，提交期间防止重复请求与提前关闭。
- 会话菜单支持重命名、置顶、归档、导出与删除。导出取消保留菜单，写入失败可重试；删除当前会话会清理对应草稿并保留其他会话。
- 置顶会话可拖动或用键盘排序。最近聊天逐批展开，两组分别保存折叠状态，搜索选中的聊天自动显示。

具体使用方式见[项目](PROJECTS.md)；完整更新见[更新记录](../CHANGELOG.md)。原始开源许可证、依赖许可证和来源声明继续保留。

## 已验证的范围

最新文件树虚拟滚动通过完整单元、类型、构建及两组原生回归。真实千文件目录分五页加载，末尾导航时挂载 41 个树节点；键盘首尾定位、分页、错误恢复、草稿与预览保持通过。[当前专项与集成证据](../verification/tree-windowing-review-result.json)。三轮完整回归仍对应较早的 `5e82af5` 基线，当前源码和新分发尚需完整复验。

| 检查 | 当前结果 |
| --- | --- |
| 类型与构建 | 通过；当前原生运行的 1075 个源码／夹具输入与 236 个编译文件按哈希核对 |
| 完整单元测试 | 144 个文件、1690 项通过 |
| 覆盖率统计范围 | 语句 97.10%、分支 94.67%、函数 97.83%、行 99.50%；新增布局模型已纳入 |
| 本轮文件树专项 | 7 项通过，2 次正常退出，461ms／493ms，无强制结束 |
| 本轮项目预览集成 | 17 项通过，2 次正常退出，444ms／979ms，无强制结束；与树专项含重复覆盖 |
| 侧栏点击修复专项 | 5 项通过，3 次正常退出，最长 1571ms；100%／125%／150% 实际点击通过 |
| 模型比较专项 | 6 项通过，3 次正常退出，最长 8821ms；实际翻页、原草稿、完整备份及缩放验证通过 |
| 分栏基线完整源码回归 | 411 项通过，75 次正常退出，最长 1805ms，无强制结束；不覆盖后续文件树修改 |
| 分栏基线包内完整回归 | 411 项通过，75 次正常退出，最长 2422ms，无强制结束 |
| 分栏基线实际安装回归 | 411 项通过，75 次正常退出，最长 2445ms，无强制结束；安装与卸载完成，16 个原有数据标记恢复 |
| 分栏基线分发验收 | 表面、文字提示、窗口关闭、启动、便携包与原运行记录检查通过；11 份运行记录匹配同组程序文件 |
| 前一轮会话专项 | 11 项通过，6 次正常退出；实际导出文件含 40 条消息，6623 字节，已核对哈希 |

文件树专项包括节点数量有界、千文件导航、祖先堆叠／推离、分页、搜索刷新、未保存草稿及暗色三档缩放。完整单元之后修正了占位块样式并补充原生观察脚本；应用逻辑和单元测试字节保持一致，随后构建及两组原生验证通过。

输入法事件保护使用合成事件检查，不等于物理输入法验收。覆盖率遵循仓库现有统计范围，不能将其解释为所有渲染界面的覆盖率。

此前完整回归 `full-retry13` 已全部通过，包含预览分栏及此前目录清理、侧栏点击和模型比较分页修正。该基线的 1,072 个输入和 236 个编译文件逐一核对，原仓库 HEAD、状态、差异和索引未变。历史失败现场继续保留。[分栏基线完整证据](../verification/preview-resize-full-review-result.json) · [前一基线](../verification/sticky-layout-full-review-result.json)

[最终专项与清理修正证据](../verification/sticky-integration-review-result.json) · [粘性目录证据](../verification/project-tree-sticky-review-result.json) · [侧栏点击修复证据](../verification/sidebar-hit-area-review-result.json) · [前缀导航证据](../verification/project-tree-prefix-review-result.json) · [前一轮会话证据](../verification/thread-action-completion-review-result.json)

## 尚未完成

已有完整分发验收对应 `5e82af5` 的同组输入与二进制，不能继承为后续虚拟滚动版本通过。[分栏专项证据](../verification/preview-resize-review-result.json) · [基线完整分发证据](../verification/preview-resize-distribution-review-result.json)

- 新版设计资料的全部页面、布局与交互对照仍在进行，不能宣称 100% 采用。文件树虚拟滚动已验证，目录压缩、完整目录操作及全部布局状态仍待落实。
- 当前完整源码与新分发待复验；未逐张审阅全部截图，也未完成物理输入法、辅助技术与其他系统 DPI 的验收。
- 原 Windows 流水线因 GitHub 账户付款／额度限制无法启动验证，发布被跳过。已归档运行见[5e82af5 的流水线](https://github.com/Moresyl/nook/actions/runs/39433081996)，验证执行步骤为 0、发布版本数为 0；后续提交按各自运行另行核实。
- 原 Chrome 连接此前核验缺少认证令牌；本轮工具列表未提供 `computer-use` 所需的 `node_repl`，未复查浏览器状态，尚未通过浏览器完成发布。

发布继续使用[原 Windows 流水线](https://github.com/Moresyl/nook/actions/workflows/windows.yml)，完成验收后发布已获授权。

## 安装与开发

当前请从[源码运行](../README.md#开始使用)。此前基线的安装包和便携包已完成本地验收，尚未发布，也不包含最新文件树修改；签名状态为 `NotSigned`。该包审计核对了 239 个产品文件、401 份依赖法律文档及 20 个分发法律／源码文件，原许可证与来源声明保留。

## English summary

Nook 0.1.0-alpha.1 is not released. The windowed file tree passes 1690 unit tests, type checking, build, native tree checks and project-preview integration. A real thousand-file directory mounts 41 tree nodes during end-of-list navigation. Full regression, new distribution acceptance and complete design alignment remain pending. The original hosted workflow is blocked by account billing or spending limits.

## 历史证据

旧记录完整保留于[2026-10-20 发布历史](RELEASE-HISTORY-2026-10-20.md)，归档 SHA-256：`786a8d8b0852d8ece699c1ff010be9313769f2deec5907a32d2849ae5dbd9030`。历史中的“当前”“本轮”和待办仅适用于各自记录时的源码，不代表今天的状态。

[设计对照](DESIGN-ALIGNMENT.md) · [界面验收](UI-ACCEPTANCE.md) · [交付要求](DELIVERY.md)
