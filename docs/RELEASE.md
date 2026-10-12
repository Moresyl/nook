# Nook 发布状态

**尚未发布。** Windows x64 候选为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 **Nook**，原始开源许可证保留。最新界面参考为 `E:\txt`，全部页面与交互尚未达到 100% 对齐。

最新产品源码 `27c36fa` 修复编辑器标签的焦点轮廓和滚动条裁切，采用内侧轮廓及 38px 标签栏。`25254c839` 冻结包已完成本机分发验收，完整流程实际退出 0；原草稿、取消、保存重试及预算保留，发布校验要求 15 张指定标签图和六组各两个完整有限轮廓。真实诊断及修复期间四轮原生失败独立保留。[标签源码与十二张原图](../verification/editor-tab-focus-acceptance-review-result.json) · [完整源码回归](../verification/editor-tab-focus-full-source-review-result.json)

上一阶段产品源码 `cd5e1bf` 修复工作树键盘刷新完成后失焦，并保留等待期间用户选择的其他控件。冻结包由 `9d7bb625` 构建，产品与桌面测试源码相同；源码、包内、五个分发专项、实际安装和原运行记录门禁均已通过，验收提交为 `8babfe8`。更早冻结包 `d32f595` 的结果按历史保留；这些结果不计入最新标签修正应用体的分发验收。

| 验证 | 最新结果 |
| --- | --- |
| 类型、构建与单元 | 最新类型、130 文件／1,524 项单元通过；策略专项 110 项，工作树与策略合计 137 项；单 worker 与四项 80% 门槛保留，覆盖率语句 96.92%、分支 94.43%、函数 97.69%、行 99.41%；236 个编译文件与本次界面构建逐一匹配 |
| 标签专项 | 类型、116 项相关单元及实际预览 10／停靠 5 项通过；六组主题／缩放各测量标签与关闭按钮，12 张源码焦点原图逐张核验 |
| 完整源码 | 361 项／74 次正常退出／最长 1,661ms／无强制；38 份新报告、536 张原图与原始配置现场保留；完整回归原图未全部视觉复核 |
| 新包与法律审计 | 239 产品文件、401 法律文件、381 依赖、20 分发许可来源，无未解决项；703 个未打包文件逐一解压校验；应用标识 `app.nook.workspace`，未签名 |
| 新包完整回归 | 361 项／74 次正常退出／最长 2,352ms／无强制；38 份新报告与 536 张原图保留，236 个编译文件匹配冻结包 |
| 新包分发 | 原控件 4／文字提示 7／关闭 2／声明 3 变体／便携 7 项均通过；原预算与断言不变 |
| 新包视觉复核 | 67 张不同原图逐张原尺寸查看并匹配归档哈希：12 张标签焦点、17 张工作树、26 张控件、12 张文字提示；完整回归其他原图和安装原图未全部复核 |
| 新包实际安装 | 361 项／74 次正常退出／最长 1,682ms／无强制；38 份新报告与 536 张原图保留，236 编译文件匹配；登记、快捷方式、保留数据卸载及原八个标记恢复／验哈希通过，安装原图尚未逐张复核 |
| 十一份运行证据 | 原命令实际退出 0，11 份记录匹配新冻结包；15 张指定标签图、35 张指定工作树图、刷新与渐进保证及六组完整有限边界通过；原数量、分页、错误、数据保留与退出条件未降低 |

[新包审计](../verification/editor-tab-focus-package-review-result.json) · [新包完整回归](../verification/editor-tab-focus-full-unpacked-review-result.json) · [实际安装](../verification/editor-tab-focus-full-installed-review-result.json) · [十一份运行记录](../verification/editor-tab-focus-runtime-review-result.json)

[12 张标签原图](../verification/editor-tab-focus-editor-originals-review-result.json) · [17 张工作树原图](../verification/editor-tab-focus-package-originals-review-result.json) · [38 张控件与文字提示原图](../verification/editor-tab-focus-distribution-originals-review-result.json)

[新包实际安装](../verification/worktree-refresh-focus-full-installed-review-result.json) · [十一份运行记录与八个原标记](../verification/worktree-refresh-focus-runtime-review-result.json)

本次原包失焦诊断与首轮缩放测量失败均独立保留。125% 时原 2px 样式的实际轮廓及偏移为 1.6 CSS px，按实际缩放和像素取整核验；发布门槛增加为 35 张指定原图、两项刷新焦点保证与六组完整数值轮廓边界。原数量、分页、错误、数据保留和退出条件未降低。[真实失焦诊断](../verification/worktree-refresh-focus-diagnostic-review-result.json) · [首轮测量失败](../verification/worktree-refresh-focus-first-source-failure-review-result.json)

以下仅为上一 `d32f595` 冻结包的已完成记录。

| 验证 | 上一冻结包结果 |
| --- | --- |
| 打包与法律审计 | 239 产品文件、401 法律文件、381 依赖、20 分发许可来源，无未解决项；703 个未打包文件逐一解压校验；应用标识 `app.nook.workspace`，未签名 |
| 完整包内回归 | 361 项／74 次正常退出／最长 1,802ms／无强制；38 份新报告与 522 张原图保留，236 个编译文件匹配冻结包 |
| 同包分发 | 原控件 4／文字提示 7／关闭 2／声明 3 变体／便携 7 项均通过；原预算与断言不变 |
| 新包视觉复核 | 47 张不同原图逐张原尺寸查看并匹配归档哈希：九张渐进工作树、26 张控件、12 张文字提示；菜单与保存后焦点六张属于控件图，不重复计数；其他完整回归原图未全部复核 |
| 实际安装与卸载 | 新包完整 361 项／74 次正常退出／最长 2,525ms／无强制；登记、快捷方式、保留数据卸载与原八个标记逐一恢复／验哈希均通过；安装原图尚未逐张复核 |
| 十一份运行证据 | 原命令实际退出 0，11 份记录匹配冻结包；新版必须具备 27 张指定列表图、三项渐进保证及六组完整有限等待区域，原桌面数量、分页、错误、数据保留与退出条件未降低 |
| 原托管流水线 | `d32f595` 已推送，验证零步骤失败，发布零步骤跳过；账户付款／支出额度限制使任务未启动，仓库无已发布版本 |

[源码与专项](../verification/worktree-progressive-source-review-result.json) · [完整源码](../verification/worktree-progressive-full-source-review-result.json) · [冻结包审计](../verification/worktree-progressive-package-review-result.json) · [完整包内回归](../verification/worktree-progressive-full-unpacked-review-result.json) · [渐进状态与焦点原图](../verification/worktree-progressive-package-originals-review-result.json) · [控件与文字提示原图](../verification/worktree-progressive-distribution-originals-review-result.json)

各轮分发文件、源码和实际退出回执独立归档。九个包的 36 份重复分发文件、三份旧候选的六份安装／便携副本及两份更早候选的四份副本，共 46 份，经逐文件字节与 SHA-256 核验后转存 C 盘，转换清单记录精确新位置。更早四份仅证明存储前后相同，不补造历史构建来源。前一批十份、本轮九份编译副本各 236 文件，经压缩测试、解压及逐文件回环匹配后改存同目录 `out.7z`；首轮目录名保护拒绝的日志保留。当前构建、冻结包编译文件、原始运行目录、资料和许可证未改变，临时目录继续为 E 盘。

上一冻结包实际安装见[完整安装回归](../verification/worktree-progressive-full-installed-review-result.json)，最终匹配见[11 份运行记录与八个原标记](../verification/worktree-progressive-runtime-review-result.json)。当时首轮原命令实际退出 1，因旧解析器仍要求 18 张列表图而拒绝新版 27 张；原解析器、日志、回执及 11 份记录均保留。[首轮失败](../verification/worktree-progressive-runtime-initial-failure-review-result.json) · [精确发布校验修正与完整单元](../verification/worktree-progressive-policy-review-result.json)

还需完成完整参考流程、物理原生向导／目录选择器、系统 DPI 与辅助技术，以及能力表保留的真实服务和目标平台检查。已授权完成后直接走原发布流水线。`25254c839` 原托管运行 [38263305814](https://github.com/Moresyl/nook/actions/runs/38263305814) 的验证因账户付款／支出额度限制零步骤失败，非标签运行的发布任务零步骤跳过，版本列表为空；原始查询证据保留在 `E:/NookVerification/EditorTabFocusSourceHosted-20261012`。最终文档和验收提交推送后另行读取其精确运行结果，避免将旧提交结果冒充新提交。原计费、执行器和发布门槛保留。

[设计差异](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付范围](DELIVERY.md) · [原界面验收](UI-ACCEPTANCE.md)

上一包 `4277c07` 的 361 项安装、74 张视觉复核、便携首轮失败与重试、全部历史失败现场及旧托管记录，逐字保存在[上一阶段发布记录](RELEASE-HISTORY-2026-10-12-SETTINGS-FOCUS.md)。正文整理没有取消历史断言、剩余范围或原始证据。
