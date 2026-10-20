# Nook 发布状态

Windows x64 候选版本 **0.1.0-alpha.1**，尚未发布。Nook 是用于对话、资料阅读和项目开发的本地 AI 工作台。

## 本轮更新

- 文件树支持直接键入文件名前缀定位，重复首字母循环查找，自动滚动显示焦点。定位不会打开文件；输入法组词与确认键受到保护。
- 会话重命名共用同一对话框，固定操作目标，保存失败保留输入并回焦，提交期间防止重复请求与提前关闭。
- 会话菜单支持重命名、置顶、归档、导出与删除。导出取消保留菜单，写入失败可重试；删除当前会话会清理对应草稿并保留其他会话。
- 置顶会话可拖动或用键盘排序。最近聊天逐批展开，两组分别保存折叠状态，搜索选中的聊天自动显示。

具体使用方式见[项目](PROJECTS.md)；完整更新见[更新记录](../CHANGELOG.md)。原始开源许可证、依赖许可证和来源声明继续保留。

## 已验证的范围

| 检查 | 当前结果 |
| --- | --- |
| 类型与构建 | 通过；1071 个源码／夹具输入与 236 个编译文件按哈希核对 |
| 完整单元测试 | 143 个文件、1682 项通过 |
| 既有覆盖率范围 | 语句 97.08%、分支 94.65%、函数 97.83%、行 99.50% |
| 原生专项 | 文件树 7 项、聊天导航 5 项通过，5 次正常退出，最长 932ms，无强制结束 |
| 前一轮会话专项 | 11 项通过，6 次正常退出；实际导出文件含 40 条消息，6623 字节，已核对哈希 |

文件树专项包括真实键盘输入、焦点滚动、分页与读取错误重试、未保存草稿、跨项目切换、明暗主题、缩放和终端。聊天专项额外放入独立背景置顶会话，验证混合列表的精确 ID 与原内容保留。完整单元和构建之后仅调整两份原生观察脚本，应用、单元测试与编译文件字节不变。

输入法事件保护使用合成事件检查，不等于物理输入法验收。覆盖率遵循仓库现有统计范围，不能将其解释为所有渲染界面的覆盖率。

[本轮文件树证据](../verification/project-tree-prefix-review-result.json) · [前一轮会话证据](../verification/thread-action-completion-review-result.json)

## 尚未完成

- 新版设计资料的全部页面、布局与交互对照仍在进行，不能宣称 100% 采用。文件树粘性目录、虚拟化等差异仍待落实与验证。
- 当前源码的完整桌面回归、新安装包、包内回归、实际安装和分发验收仍待完成。旧版本的完整通过不能替代当前应用体。
- 本轮完整回归在 225 项、22 次正常退出后，发现观察脚本错误地假设没有既有置顶会话。已修正为完整 ID 集合与原字段比较，并通过专项复现；261 份输出与通过完整性检查的现场归档保留。修正后只读检查再次发现零字节文本和 HTML 剪贴板，因此尚未完整重跑；未清空剪贴板或放宽恢复检查。
- 原 Windows 流水线此前因 GitHub 账户付款／额度限制无法启动验证，发布被跳过。最新已归档运行见[253bdfe 的流水线](https://github.com/Moresyl/nook/actions/runs/39401593259)；后续提交按各自运行另行核实。
- 原 Chrome 连接上次核验缺少认证令牌，尚未通过浏览器完成发布。

发布继续使用[原 Windows 流水线](https://github.com/Moresyl/nook/actions/workflows/windows.yml)，完成验收后发布已获授权。

## 安装与开发

当前请从[源码运行](../README.md#开始使用)。历史安装包和便携包仅用于对应版本的验收，不作为当前候选已发布的依据；已验证的历史产物未签名。

## English summary

Nook 0.1.0-alpha.1 is not released. File-tree prefix navigation, type checking, build, 1,682 unit tests and 12 targeted native checks pass. A full run exposed a pre-existing-pin assumption in the observer after 225 checks; the corrected observer passes targeted reproduction. A full rerun, design alignment, distribution acceptance and publication remain pending. The original hosted workflow has been blocked by account billing or spending limits.

## 历史证据

旧记录完整保留于[2026-10-20 发布历史](RELEASE-HISTORY-2026-10-20.md)，归档 SHA-256：`786a8d8b0852d8ece699c1ff010be9313769f2deec5907a32d2849ae5dbd9030`。历史中的“当前”“本轮”和待办仅适用于各自记录时的源码，不代表今天的状态。

[设计对照](DESIGN-ALIGNMENT.md) · [界面验收](UI-ACCEPTANCE.md) · [交付要求](DELIVERY.md)
