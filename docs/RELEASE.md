# Nook 发布状态

**尚未发布。** 当前 Windows x64 候选版本为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 Nook；原始开源许可证与来源声明保留。最终验收通过后按原流水线发布，已获授权，无需再次确认。

## 当前应用体

当前编译来源为 `71fc205`：新增会话内任务步骤记录，并保留共享按钮 24px／8px／4px 默认规格、输入框 22px 圆角和小于 40rem 的浅色阴影调整。只读工作树身份查询采用四项一批；三个独立 Git 元数据读取并行等待，删除仍串行并保留完整复查。原生验收来源 `8e6fec8` 与该构建的 304 个产品源码输入、236 个编译文件逐字匹配，后续更改仅涉及验证脚本、报告和文档。

| 检查 | 已验证结果 |
| --- | --- |
| 类型与构建 | 本轮实际通过；保留准确源码和 236 个编译文件 |
| 完整单元与覆盖率 | 本轮重新执行 135 文件／1,585 项，通过；既有统计范围的语句／分支／函数／行覆盖率为 97.04%／94.58%／97.79%／99.49%，原 80% 门槛不变 |
| 任务步骤原生专项 | 8 组、12 种主题／尺寸／缩放布局；每项步骤可完整滚动阅读，16 张原图逐张检查；两次正常退出，最长 438ms，无强制结束 |
| 共享按钮与首页原生专项 | 13 项、两次正常退出，最长 296ms；两种主题、两种尺寸、三档应用缩放；37 张原图逐张复核 |
| 原生状态 | 默认、键盘焦点、悬停、按下、禁用状态与真实记忆控件验证；禁用保存不获取焦点、不改变已存记忆 |
| 前一输入框完整源码 | `9f50a58` 通过 375 项、74 次正常退出，最长 1,712ms；39 份报告与 617 张原图归档，原图未全部逐张视觉复核 |
| 共享按钮冻结源码 | 新读取优化前的应用体通过 375 项、74 次正常退出，最长 4,592ms，无强制结束；39 份新报告、617 张原图和 236 个匹配编译文件归档，原图未全部逐张视觉复核 |
| 当前完整源码 | 383 项、75 次正常退出，最长 2,418ms，无强制结束；40 份报告、633 张原图、236 个匹配编译文件与工作区归档，完整原图未全部逐张复核 |
| 当前分发 | 任务步骤与读取优化后的包内、实际安装与便携仍待验收；前一应用体记录不能替代 |

首页专项实际系统缩放为 100%，没有强制设备缩放。完整源码套件保留原精确尺寸夹具和全部期限；它不能替代其他实际系统 DPI、物理交互与真实服务验收。

[当前单元与构建](../verification/task-plan-build-review-result.json) · [任务步骤与原图](../verification/task-plan-native-review-result.json) · [先前按钮状态](../verification/shared-button-defaults-native-review-result.json) · [先前按钮完整源码](../verification/shared-button-defaults-full-source-review-result.json)

本轮完整源码首次运行通过 197 项后，在 HTML 预览的弹窗拒绝检查处超过原 5 秒主进程期限，实际退出 1；21 次退出均正常，9 份报告、213 张原图、准确编译文件和工作区保留。随后未改动产品、验证逻辑或期限，原文件树／预览集成专项 17 项独立重跑通过，两次正常退出，最长 1,729ms；37 张新原图保留，未全部逐张复核。失败原因仍未确认，完整源码需另行重跑，不能写成已修复。[完整源码失败](../verification/task-plan-full-source-initial-failure-review-result.json) · [独立集成重跑](../verification/task-plan-preview-integration-review-result.json)

随后在相同产品与验证输入上重跑完整源码，383 项全部通过，75 次正常退出，最长 2,418ms。全部报告、原图和工作区归档完整性验证通过；该结果不确认首次超时的原因，也不代替新包与实际安装。[完整源码重跑](../verification/task-plan-full-source-review-result.json)

首轮完整源码因旧圆角断言失败，实际退出 1；原日志、24 张截图、工作区及准确编译文件均保留。修改测试期望后重跑通过。归档助手另曾使用错误的报告文件名，在复制前退出 1；已按原验证器修正并保留记录，没有重写产品或降低验收条件。[首轮失败现场](../verification/composer-surface-tokens-full-source-failure-review-result.json)

## 分发与发布

前一冻结记忆弹窗应用体已完成源码、未安装程序、实际安装程序三轮 375 项，以及原五个分发专项、便携七项、快捷方式与保留数据卸载。**这些记录属于前一应用体；当前按钮与输入框改动后的安装与便携包仍须重新验收。** 前一候选未签名。

[前一完整分发](../verification/memory-delete-default-surface-runtime-review-result.json) · [安装后回归](../verification/memory-delete-default-surface-full-installed-review-result.json)

前一交付提交 `d72d5ef` 已推送；原[流水线 38413577535](https://github.com/Moresyl/nook/actions/runs/38413577535) 完成环境准备与类型检查后，在单元覆盖率阶段因六项既有测试超时失败：133 文件中 127 通过，1,557 项中 1,551 通过。后续打包与发布未执行，该次失败现场保留；原期限、数据样本和完整验收要求保留。此前账户限制／零步骤失败属于历史。浏览器连接仍返回认证令牌不可用，页面未打开；尚无发布标签或可下载版本。[本次终态与完整失败日志](../verification/shared-button-defaults-hosted-terminal-review-result.json) · [此前进度快照](../verification/shared-button-defaults-hosted-progress-review-result.json)

六项测试的开销修复已通过本机类型、六文件／134 项专项及 133 文件／1,557 项完整覆盖率验证，覆盖率仍为 97.03%／94.57%／97.78%／99.49%。大样本、完整字节相等、真实 Git 所有权与快照检查、原期限和工作流保持有效；生产逻辑未改动。随后重跑原托管流水线，本机通过不能替代托管终态、包内与实际安装验收。[修复与完整验证](../verification/hosted-test-performance-review-result.json)

## 剩余交付

第三次原[托管流水线 38425482322](https://github.com/Moresyl/nook/actions/runs/38425482322) 对提交 `544c8c9` 的验证任务执行零步骤。GitHub 注释明确指出近期账户付款失败或需要提高额度；任务日志实际不存在，获取日志的失败单独保留。因此该次运行没有验证新读取优化的托管结果。未修改付款或额度设置，仍无标签和已发布版本。[本次零步骤与平台注释](../verification/worktree-read-performance-hosted-review-result.json)

第二次原[托管流水线 38421009903](https://github.com/Moresyl/nook/actions/runs/38421009903) 的 1,557 项中 1,556 通过，仅真实工作树清理用例超过原 5 秒期限，后续打包未执行。现将只读身份查询限制为四项一批，并并行执行三个独立 Git 元数据读取；删除操作继续串行，所有身份、索引与删除前复查保留。新增混合回执与读取失败等待检查，全部 1,559 项与原覆盖率门槛通过。首次新增 Windows 夹具写入隐藏 `.git` 文件的失败保留，按已有 `r+` 模式修正后通过。该源码需要新构建、完整原生与分发回归，并重跑原流水线。[第二次托管失败](../verification/hosted-test-performance-rerun-terminal-review-result.json) · [新读取验证与原失败记录](../verification/worktree-read-performance-review-result.json)

- 补齐当前应用体的安装、便携和分发回归。
- 逐项完成新版设计资料的页面、状态与交互对照；尚不能宣称 100% 采用。
- 完成实际系统 DPI、物理交互、无障碍和真实服务的相应验收。
- 通过原标签流水线，核对下载文件、准确源码、法律文件、SHA-256 和具体中英文版本说明。

[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md) · [界面验收](UI-ACCEPTANCE.md)

此前完整发布说明逐字保留于[历史记录](RELEASE-HISTORY-2026-10-13-COMPOSER.md)，SHA-256 为 `1e09973e261edeccd78950612bf1164beaee4859df9895a954a3f99cbf0da9d0`。历史失败、旧原图和验收要求继续保留。
