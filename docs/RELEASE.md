# Nook 发布状态

Windows x64 候选版本 **0.1.0-alpha.1**，尚未发布。Nook 是用于对话、资料阅读和项目开发的本地 AI 工作台。

## 本轮更新

- 文件树滚动时保留展开的祖先目录，在子树末尾推离；键盘定位避开固定目录，矮窗口下编辑器空态说明保持可读。
- 紧凑侧栏的会话和操作按钮分开布局，修复高缩放时操作按钮拦截会话点击的问题。
- 文件树支持直接键入文件名前缀定位，重复首字母循环查找，自动滚动显示焦点。定位不会打开文件；输入法组词与确认键受到保护。
- 会话重命名共用同一对话框，固定操作目标，保存失败保留输入并回焦，提交期间防止重复请求与提前关闭。
- 会话菜单支持重命名、置顶、归档、导出与删除。导出取消保留菜单，写入失败可重试；删除当前会话会清理对应草稿并保留其他会话。
- 置顶会话可拖动或用键盘排序。最近聊天逐批展开，两组分别保存折叠状态，搜索选中的聊天自动显示。

具体使用方式见[项目](PROJECTS.md)；完整更新见[更新记录](../CHANGELOG.md)。原始开源许可证、依赖许可证和来源声明继续保留。

## 已验证的范围

| 检查 | 当前结果 |
| --- | --- |
| 类型与构建 | 通过；最终完整运行的 1072 个源码／夹具输入与 236 个编译文件按哈希核对 |
| 完整单元测试 | 143 个文件、1685 项通过 |
| 既有覆盖率范围 | 语句 97.08%、分支 94.65%、函数 97.83%、行 99.50% |
| 本轮文件树专项 | 最终复跑 7 项通过，2 次正常退出，502ms／412ms，无强制结束 |
| 侧栏点击修复专项 | 5 项通过，3 次正常退出，最长 1571ms；100%／125%／150% 实际点击通过 |
| 模型比较专项 | 6 项通过，3 次正常退出，最长 8821ms；实际翻页、原草稿、完整备份及缩放验证通过 |
| 完整源码桌面回归 | 411 项通过，75 次正常退出，最长 2527ms，无强制结束；530 份变化输出已按哈希归档 |
| 前一轮会话专项 | 11 项通过，6 次正常退出；实际导出文件含 40 条消息，6623 字节，已核对哈希 |

文件树专项包括祖先堆叠、子树末尾推离、点击与键盘折叠、分页、搜索刷新、未保存草稿及暗色 100%／125%／150% 缩放。原草稿与磁盘文件逐字核对保留。完整单元之后调整了界面样式和原生观察脚本；应用逻辑和单元测试字节保持一致。后续侧栏修复另行验证。

输入法事件保护使用合成事件检查，不等于物理输入法验收。覆盖率遵循仓库现有统计范围，不能将其解释为所有渲染界面的覆盖率。

最新完整回归 `full-retry12` 已全部通过，修正后的目录清理、侧栏点击及模型比较分页均在完整工作区中验证。三轮失败现场保留；最终输入和编译文件逐一核对，原仓库 HEAD、状态、差异和索引未变。[完整源码证据](../verification/sticky-layout-full-review-result.json) · [分页修正证据](../verification/comparison-pagination-review-result.json)

[最终专项与清理修正证据](../verification/sticky-integration-review-result.json) · [粘性目录证据](../verification/project-tree-sticky-review-result.json) · [侧栏点击修复证据](../verification/sidebar-hit-area-review-result.json) · [前缀导航证据](../verification/project-tree-prefix-review-result.json) · [前一轮会话证据](../verification/thread-action-completion-review-result.json)

## 尚未完成

- 新版设计资料的全部页面、布局与交互对照仍在进行，不能宣称 100% 采用。粘性目录已专项验证，文件树虚拟化、缩进及全部布局状态仍待落实与验证。
- 当前源码完整回归已通过；新安装包、包内回归、实际安装和分发验收仍待完成。源码通过不能替代包内与安装验证。
- 原 Windows 流水线因 GitHub 账户付款／额度限制无法启动验证，发布被跳过。最新已归档运行见[8db1afa 的流水线](https://github.com/Moresyl/nook/actions/runs/39414934070)，验证执行步骤为 0、发布版本数为 0；后续提交按各自运行另行核实。
- 原 Chrome 连接上次核验缺少认证令牌，尚未通过浏览器完成发布。

发布继续使用[原 Windows 流水线](https://github.com/Moresyl/nook/actions/workflows/windows.yml)，完成验收后发布已获授权。

## 安装与开发

当前请从[源码运行](../README.md#开始使用)。历史安装包和便携包仅用于对应版本的验收，不作为当前候选已发布的依据；已验证的历史产物未签名。

## English summary

Nook 0.1.0-alpha.1 is not released. Sticky folder ancestors, canonical focus, short-window editor copy and sidebar click targets are verified. All 411 source desktop checks pass with 75 normal exits and no forced termination; 1,685 unit tests pass. Full design alignment, new package and installation acceptance, and publication remain pending. The original hosted workflow is blocked by account billing or spending limits.

## 历史证据

旧记录完整保留于[2026-10-20 发布历史](RELEASE-HISTORY-2026-10-20.md)，归档 SHA-256：`786a8d8b0852d8ece699c1ff010be9313769f2deec5907a32d2849ae5dbd9030`。历史中的“当前”“本轮”和待办仅适用于各自记录时的源码，不代表今天的状态。

[设计对照](DESIGN-ALIGNMENT.md) · [界面验收](UI-ACCEPTANCE.md) · [交付要求](DELIVERY.md)
