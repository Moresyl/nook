# Nook 发布状态

**尚未发布。** Windows x64 候选为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 **Nook**，原始开源许可证保留。最新界面参考为 `E:\txt`，全部页面与交互尚未达到 100% 对齐。

当前冻结包来自 `d32f595`，产品与桌面测试源码和已验收的 `3de2a63` 一致；236 个编译文件逐一匹配。随后只加强了独立的发布解析器、类型和单元测试，未改变应用编译内容或原生桌面套件。以下记录区分源码、新包与历史包，不将旧包结果计入新包验收。

| 验证 | 最新结果 |
| --- | --- |
| 类型、构建与单元 | 最新类型、130 文件／1,521 项单元通过；发布策略专项 107 项；单 worker 与四项 80% 门槛保留，覆盖率语句 96.92%、分支 94.43%、函数 97.69%、行 99.41%；原通过构建的 236 文件未改变 |
| 工作树专项 | 27 项相关单元及六组 Electron 原生检查通过；五次正常退出／最长 502ms；渐进结果、脱敏错误、管理加载保护、合并后的会话展开状态与六组明暗缩放等待项均核验 |
| 完整源码 | 361 项／74 次正常退出／最长 1,629ms／无强制；38 份新报告、522 张原图与原始配置现场保留 |
| 打包与法律审计 | 239 产品文件、401 法律文件、381 依赖、20 分发许可来源，无未解决项；703 个未打包文件逐一解压校验；应用标识 `app.nook.workspace`，未签名 |
| 完整包内回归 | 361 项／74 次正常退出／最长 1,802ms／无强制；38 份新报告与 522 张原图保留，236 个编译文件匹配冻结包 |
| 同包分发 | 原控件 4／文字提示 7／关闭 2／声明 3 变体／便携 7 项均通过；原预算与断言不变 |
| 新包视觉复核 | 47 张不同原图逐张原尺寸查看并匹配归档哈希：九张渐进工作树、26 张控件、12 张文字提示；菜单与保存后焦点六张属于控件图，不重复计数；其他完整回归原图未全部复核 |
| 实际安装与卸载 | 新包完整 361 项／74 次正常退出／最长 2,525ms／无强制；登记、快捷方式、保留数据卸载与原八个标记逐一恢复／验哈希均通过；安装原图尚未逐张复核 |
| 十一份运行证据 | 原命令实际退出 0，11 份记录匹配冻结包；新版必须具备 27 张指定列表图、三项渐进保证及六组完整有限等待区域，原桌面数量、分页、错误、数据保留与退出条件未降低 |
| 原托管流水线 | `d32f595` 已推送，验证零步骤失败，发布零步骤跳过；账户付款／支出额度限制使任务未启动，仓库无已发布版本 |

[源码与专项](../verification/worktree-progressive-source-review-result.json) · [完整源码](../verification/worktree-progressive-full-source-review-result.json) · [冻结包审计](../verification/worktree-progressive-package-review-result.json) · [完整包内回归](../verification/worktree-progressive-full-unpacked-review-result.json) · [渐进状态与焦点原图](../verification/worktree-progressive-package-originals-review-result.json) · [控件与文字提示原图](../verification/worktree-progressive-distribution-originals-review-result.json)

新包的安装文件、便携文件、未打包内容、源码、编译文件及实际退出回执已独立归档。为保留运行现场，旧五个包归档中的 20 份重复分发文件经逐文件字节与 SHA-256 核验后转存 C 盘；各原包的 `artifact-overflow-storage-conversion.json` 记录精确新位置。原始运行目录、资料和许可证未改变，临时目录继续为 E 盘。

当前实际安装证据见[完整安装回归](../verification/worktree-progressive-full-installed-review-result.json)，最终匹配证据见[11 份运行记录与八个原标记](../verification/worktree-progressive-runtime-review-result.json)。首轮原命令实际退出 1，因旧解析器仍要求 18 张列表图而拒绝新版 27 张；原解析器、日志、回执及 11 份记录均保留。[首轮失败](../verification/worktree-progressive-runtime-initial-failure-review-result.json) · [精确发布校验修正与完整单元](../verification/worktree-progressive-policy-review-result.json)

还需完成完整参考流程、物理原生向导／目录选择器、系统 DPI 与辅助技术，以及能力表保留的真实服务和目标平台检查。全部完成后直接走原发布流水线，无需再次确认。原托管运行 [38226997225](https://github.com/Moresyl/nook/actions/runs/38226997225) 的实际限制证据保留在 `E:/NookVerification/WorktreeProgressiveHosted-20261012`；未改变计费、执行器或发布门槛。

[设计差异](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付范围](DELIVERY.md) · [原界面验收](UI-ACCEPTANCE.md)

上一包 `4277c07` 的 361 项安装、74 张视觉复核、便携首轮失败与重试、全部历史失败现场及旧托管记录，逐字保存在[上一阶段发布记录](RELEASE-HISTORY-2026-10-12-SETTINGS-FOCUS.md)。正文整理没有取消历史断言、剩余范围或原始证据。
