# Nook 发布状态

**尚未发布。** Windows x64 候选版本为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 **Nook**，原始开源许可证保留。已授权完成验收后直接通过原流水线发布，无需再次确认。

新一轮记忆删除采用 520px／92vw、20px 圆角与独立内容滚动。取消为初始焦点，删除等待禁用关闭，失败保留原内容与持久化字节。初版 1,555 项完整单元／覆盖率、类型与构建通过；焦点修正后重跑类型、124 项相关测试与构建，覆盖率范围和测试文件逐字未变。最新真实桌面五组专项、六种主题／应用缩放、22 张逐张复核原图及一次 461ms 正常退出通过。前三轮失败分别为初始焦点、错误角色选择器歧义和遗留专项计数，原现场均保留。新的完整桌面最低 375 项，新包与安装验收尚待完成，下面 373 项分发结果属于此前设置候选。[初版单元](../verification/memory-delete-unit-review-result.json) · [焦点修正](../verification/memory-delete-focus-correction-review-result.json) · [原生专项](../verification/memory-delete-focused-review-result.json) · [原图复核](../verification/memory-delete-visual-review-result.json)

本轮全局搜索采用 520px 上限与 92vw 收缩、明暗表面和有界定位，键盘选择末项时完整显示。输入区 `/` 快捷选择保留原文和光标位置，选择助手或项目不会发送消息。命令输出节流会补发最后一段更新，关闭、报错和取消后停止通知。[快捷选择](COMPOSER-ACTIONS.md)

最新设置保护模型、桌面、工作树、MCP、插件和记忆六类未保存表单：默认继续编辑，保存等待阻止重复操作，失败保留输入。133 文件／1,555 项单元、类型、构建和八组设置专项通过。完整源码、同一新包与实际安装各通过 373 项和 74 次正常退出，最长分别为 1,725／2,429／2,054ms，无强制结束；每轮保留 39 份新报告、597 张原图和 236 个匹配编译文件。原五个分发专项、便携七项、安装登记／快捷方式、保留数据卸载及十一份匹配运行记录通过。十二个既有数据标记恢复原路径并核对哈希。[设置用法](SETTINGS.md) · [单元](../verification/settings-drafts-unit-review-result.json) · [完整源码](../verification/settings-drafts-full-source-review-result.json) · [新包](../verification/settings-drafts-package-review-result.json) · [包内回归](../verification/settings-drafts-full-unpacked-review-result.json) · [安装回归](../verification/settings-drafts-full-installed-review-result.json) · [运行与卸载](../verification/settings-drafts-runtime-review-result.json)

源码专项、包内与安装轮各 34 张设置原图已逐张查看。安装轮先前七张“缩放不符”的目测判断已更正：30 张缩放原图的像素测量与冻结源码及对应包内原图一致，侧栏为 128／160／192px，确认框为 420／525／630px，对应 100%／125%／150%。七张原图已再次查看，原文件、哈希与先前记录保留，没有重拍或修改产品。各轮设置原图通过；每轮 597 张完整回归原图未全部视觉复核，最终界面与托管发布仍待完成。[包内原图](../verification/settings-drafts-unpacked-visual-review-result.json) · [安装原始判断](../verification/settings-drafts-installed-visual-review-result.json) · [像素测量与更正](../verification/settings-drafts-installed-scale-correction-result.json)

包源为 `21bfce7`，测试源为 `7a15cce`。新包回归前两轮各在 186 项后失败，第一轮设置选择器要求紧凑侧栏隐藏的 Ctrl 后缀，第二轮新增 title 属性断言不适用于共享提示组件。两轮各保留实际退出 1、19 次正常退出、8 份新报告、166 张原图及工作区；第三轮保留原断言与期限，使用既有侧栏角色入口后通过。产品二十个既有校验输入和 236 个编译文件不变，测试覆盖文件及准确源码 tar 单独归档。[第一轮](../verification/settings-drafts-full-unpacked-failure-review-result.json) · [第二轮](../verification/settings-drafts-full-unpacked-failure2-review-result.json)

设置专项的前两次尝试因错误提示选择器包含关闭提示文本、随后匹配到两个元素而失败。原日志、原图及工作区保留；只修正一次测试选择表达式后通过，十八个其他源码输入及 236 个编译文件未变。单元源码归档加明确的测试覆盖文件可复现这轮专项，未降低检查或超时。

首轮完整源码在 133 项后失败：旧桌面测试关闭保存失败的快捷键草稿后直接点击后台入口，被新确认框拦截。测试现明确放弃该草稿，再保留原有错误、注册释放与重试检查；完整重跑通过。失败轮的实际退出 1、11 次正常退出、两份新报告、84 张原图和工作区均保留。当前归档记录十九个原测试输入与一个桌面测试输入，产品和编译字节不变。[完整失败现场](../verification/settings-drafts-full-source-failure-review-result.json)

设置分发证据提交 `0c39151` 已推送，原[流水线 38366937353](https://github.com/Moresyl/nook/actions/runs/38366937353) 仍因账户付款／额度限制实际零步骤失败，发布跳过。浏览器于 2026-10-13 再次连接返回认证令牌不可用，页面未打开。原始响应、作业、注释与认证失败记录保留；当前标签和版本均为零。[本轮托管证据](../verification/settings-drafts-delivery-hosted-review-result.json)

最新源码另已加入本地分支重命名和安全删除，原八组分支专项增加到 11 组，34 张原始截图逐张复核。两轮完整覆盖率测试分别通过 1,547 和 1,550 项，最终 132 个文件全部通过，语句／分支／函数／行覆盖率为 97.03%／94.57%／97.78%／99.49%；类型与构建通过。发布校验提高为完整桌面 371 项、分支 11 组与 34 张原图，原步骤及其他要求保留。[分支功能](PROJECT-GIT.md) · [两轮单元与发布校验](../verification/project-branch-actions-unit-review-result.json)

冻结源码 `10db2c6` 已完成 371 项完整开发程序回归，74 次正常退出，最长 1,783ms，无强制结束。39 份新报告、581 张原图、完整工作区与 236 个匹配编译文件已归档；这批原图未全部逐张视觉复核。此前九份旧格式模块报告没有单独退出字段，正常退出以完整报告和实际进程日志为准。[本轮完整源码](../verification/project-branch-actions-full-source-review-result.json)

包源提交 `923ea697` 的[原流水线 38336442387](https://github.com/Moresyl/nook/actions/runs/38336442387) 因账户付款／支出额度限制未启动验证，实际零步骤，发布跳过；浏览器重试仍因认证令牌不可用未打开页面。没有标签或版本发布。[包源托管证据](../verification/project-branch-actions-source-delivery-hosted-review-result.json) · [应用提交的前次运行](../verification/project-branch-actions-hosted-review-result.json)

本轮包含分支重命名与安全删除的新包已完成本机分发验收。编译应用体来自 `10db2c6`，包源为 `923ea697`，236 个编译文件逐文件匹配。实际安装验证的来源另包含一处明确归档的计数修正：分支专项由 8 组提高到 11 组。

| 验证 | 当前证据 |
| --- | --- |
| 源码与构建 | 类型通过；236 个编译文件与专项及安装包逐文件匹配 |
| 单元与覆盖率 | 132 文件／1,550 项通过；语句 97.03%、分支 94.57%、函数 97.78%、行 99.49% |
| 分支源码专项 | 保留原八组并新增三组；11 组、明暗三档应用缩放、34 张逐张复核原图及两次正常退出通过 |
| 包内完整回归 | 371 项、74 次正常退出、最长 4,208ms，无强制结束 |
| 实际安装后回归 | 同一应用体：371 项、74 次正常退出、最长 1,692ms，无强制结束 |
| 分发与数据保留 | 原五个专项与便携七项通过；注册、快捷方式、卸载保留数据、八个原始及四个失败轮次标记哈希恢复、十一份匹配运行记录通过 |
| 本轮原图 | 源码、包内与安装后各保留 39 份新报告及 581 张原图；专项源码、包内与安装后各 34 张分支原图逐张复核；其余原图未全部视觉复核 |
| 身份与许可 | 239 个产品文件、401 份完整依赖法律文件及 20 份分发法律／来源文件核对通过，旧可见身份与未解决许可项为空；安装包未签名 |
| 托管流水线 | 精确应用提交的原流水线受账户付款／支出额度限制，验证零步骤失败、发布跳过；浏览器连接缺少认证令牌 |

[构建与许可](../verification/project-branch-actions-package-review-result.json) · [包内回归](../verification/project-branch-actions-full-unpacked-review-result.json) · [安装后回归](../verification/project-branch-actions-full-installed-review-result.json) · [分发与数据保留](../verification/project-branch-actions-runtime-review-result.json) · [包内分支原图](../verification/project-branch-actions-unpacked-visual-review-result.json) · [安装分支原图](../verification/project-branch-actions-installed-visual-review-result.json)

首次安装轮次完成 371 项原生检查后，被脚本遗留的“分支 8 组”条件拒绝，整轮仍记录为失败。修正为实际要求的 11 组后，同一不可变应用重新完成安装、完整回归与卸载；原失败日志、原图、工作区及十二个既有标记保留。其他验收条件、超时和流水线不变。复现这轮验证须使用包源归档加明确记录的脚本覆盖文件。[失败与完整重跑](../verification/project-branch-actions-installer-retry-review-result.json)

代码、测试与本机安装验收不能替代成功的标签流水线和可下载产物核对；目前尚未进行浏览器发布。

界面依据最新版 `E:/txt`（26.930.41038／build 13022）逐项采用，**全部页面与交互尚未达到 100% 对齐**。全局搜索的 520px 上限与输入区锚定浮层的 420px 上限属于不同入口。合法 Inter／系统中文字体及独立品牌保留明确差异；物理输入、系统 DPI、无障碍、真实服务与其他平台仍需各自验收。[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md)

上一份说明逐字保留在[分支分发验收前发布记录](RELEASE-HISTORY-2026-10-13-BRANCH-ACTIONS.md)，SHA-256 为 `9d8cfeb4aed09a930cbb7a486b3631da44611e4f442df91f7f5132c9a3cd7856`。其中前轮搜索候选、失败现场、原图范围与更早历史链接继续保留，未取消任何剩余要求。
