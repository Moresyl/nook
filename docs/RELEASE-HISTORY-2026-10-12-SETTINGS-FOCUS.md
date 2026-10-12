# Nook 发布状态

**尚未发布。** Windows x64 候选为 `0.1.0-alpha.1`。项目、图标和产品说明统一为 **Nook**，原始开源许可证完整保留。界面依据最新 `E:\txt` 资料持续完善，尚未达到全部页面 100% 还原。

[最新源码与 1,518 项单元](../verification/worktree-progressive-source-review-result.json) · [上一冻结包完整 361 项](../verification/settings-action-focus-full-unpacked-review-result.json) · [上一包体审计](../verification/settings-action-focus-package-review-result.json)

最新源码增加工作树渐进读取，完整源码 361 项通过，74 次正常退出／最长 1,629ms／无强制；38 份新原始报告、522 张原图和原始测试资料保留，236 编译文件与专项一致。[完整源码回归](../verification/worktree-progressive-full-source-review-result.json)。新应用体的打包、安装与分发尚未验收，下表的 `4277c07` 冻结包记录保留为上一应用体的独立证据。

| 验证 | 当前结果 |
| --- | --- |
| 完整单元 | 最新渐进读取的完整 130 文件／1,518 项通过，383.71 秒；语句 96.92%、分支 94.43%、函数 97.69%、行 99.41%；单 worker 与四项 80% 门槛保留 |
| 类型与构建 | 最新渐进读取和合并后展开状态的类型、构建通过，236 个编译文件已冻结 |
| 工作树专项 | 27 项相关单元与加强后的六组原生专项通过，五次正常退出／最长 502ms／无强制；27 张原图保留，九张新增状态逐张复核，六组明暗缩放检查整个等待项可见 |
| 完整源码回归 | 最新应用体完整 361 项、74 次正常退出／最长 1,629ms／无强制通过；38 份新报告、522 张原图和原始配置现场归档；整轮原图没有全部复核 |
| 设置专项 | 控件 4／搜索 6／固定 6／MCP PDF 8 项通过，9 次正常退出／最长 492ms；控件第二轮 4 项另通过、293ms 正常退出；明暗保存后完整蓝色焦点圈两张原图逐张复核 |
| 包体审计 | 当前 `4277c07`：239 个产品文件、401 份法律文件、381 个依赖、20 份分发许可来源，无未解决项且未签名；应用标识 `app.nook.workspace`，703 个未打包文件压缩后逐个解压校验通过 |
| 完整包内回归 | 当前同包 361 项通过，74 次正常退出／最长 2,516ms、无强制；38 份新原始报告、513 张原图与配置现场保留，236 个编译文件匹配冻结包 |
| 同包分发专项 | 控件 4／文本提示 7／关闭 2／声明 3 变体／便携 7 项均通过；便携首轮因 E 盘耗尽空间失败，完整现场保留，腾出空间后原样重试通过 |
| 视觉复核 | 当前同包搜索 18、控件 26、文本提示 12、工作树列表 18 张不同原图已逐张原尺寸核验，共 74 张；保存后焦点两张属于控件图，不重复计数；其他完整回归原图仍未全部检查 |
| 实际安装 | 当前同包实际安装的完整 361 项通过，74 次正常退出／最长 1,787ms、无强制；登记、快捷方式和保留数据卸载通过，原 8 个数据标记全部恢复且哈希一致 |
| 物理目录选择器 | 两次隔离尝试均未通过：桌面截图／应用控件不可用；测试进程按已核实身份强制清理，日志和原配置目录保留，不计为正常关闭或选择器通过 |
| 同包运行记录 | 原 11 份匹配记录实际通过，未安装／实际安装／便携均匹配当前冻结包；旧包记录不计为新版通过 |
| 托管流水线 | 最近取证提交 `4277c07` 已推送；GitHub 因账户付款／支出额度限制未开始验证，发布任务跳过 |

当前 `4277c07` 的完整包内、实际安装和五个分发专项均重新通过；236 个编译文件匹配冻结包，原十一份运行记录通过。完整发布门槛保留原条件，并增加设置搜索至至少 361 项；原生安装向导仍是独立待验项。此前 `cf22dd0` 的 355 项记录按旧应用体保留，不作为新版凭据。[当前实际安装](../verification/settings-action-focus-full-installed-review-result.json) · [当前运行记录与数据保留](../verification/settings-action-focus-runtime-review-result.json) · [上一包实际安装](../verification/worktree-pin-focus-installed-native-review-result.json)

快速聊天保存已接入绑定原文件版本的小型检查点，保留独立草稿、完整前一版本备份与重启恢复。结构改变、外部替换或达到原有 8 MB 上限时完整保存。大历史默认专项 9 项与 28 张原图复核通过；完整包内回归也通过该段，不据此承诺全部延迟。[完整单元](../verification/quick-chat-journal-full-unit-retry-review-result.json) · [大历史重放](../verification/quick-chat-journal-large-history-replay-review-result.json)

固定操作完成后，控件在恢复可用时回焦并滚动完整操作区域。原六组专项通过，两主题三档缩放下的完整错误和蓝色键盘边框均逐张确认。[固定专项](../verification/worktree-pin-focus-native-review-result.json) · [21 张原图](../verification/worktree-pin-focus-originals-review-result.json)

上一分发验收包的无项目空列表另通过六组原生检查与六张原图复核。标题、说明和完整正文在两主题三档缩放下可见，状态保持、无外部请求和正常退出均核实；不将其扩大为全部参考页面验收。[空列表原图](../verification/worktree-pin-focus-empty-overview-originals-review-result.json)

工作树支持项目登记、关联聊天、本机固定、私有快照、新目录恢复及保存快照后的安全删除。自动清理默认关闭，保留数量为 1～50；固定聊天、正在运行的回复／终端、草稿、锁定或含改动目录均受保护。外部与身份变化目录无删除权限；私有快照最多 100 份，保存失败或达到上限时停止清理。应用内排他不等于外部文件进程加锁。

此前两次旧包 247 项后失败、新检查点包 308／321 项后失败、登记原样重放及新增大文件测试默认超时，均保留完整现场与原断言。仅新增单项使用 10 秒聚合预算；原启动 30 秒、关闭 10 秒、持有操作 5 秒、桥接 10 秒及快速聊天 5 秒不变。全部历史说明已逐字存档于[检查点阶段记录](RELEASE-HISTORY-2026-10-12-QUICK-JOURNAL.md)。

最近取证的托管运行 [38209087695](https://github.com/Moresyl/nook/actions/runs/38209087695) 对应 `4277c07`，验证为零步骤失败，实际注释为近期付款失败或支出额度受限；发布任务零步骤跳过，仓库尚无已发布版本。未调整账户计费、替换执行器或绕过发布门槛。[实际托管记录](../verification/settings-action-focus-hosted-review-result.json)

当前包的源码、236 个编译文件和原始分发文件已冻结留存，完整包内、实际安装和五个分发专项通过。便携版首次失败仅完成两项，旧七项报告已排除，原配置与不完整归档均保留；腾出空间后原样重试通过，两次正常退出分别为 892ms／1,163ms。[当前便携重试](../verification/settings-action-focus-phase-portable-review-result.json) · [首次失败现场](../verification/settings-action-focus-portable-initial-failure-review-result.json) · [物理选择器失败现场](../verification/settings-search-sidebar-physical-attempts-result.json)

最新设置修正保留缓存草稿，使普通分类回到标题，并在保存导致焦点退到背景时恢复原控件。原滚动与焦点断言通过；第二轮另实测明暗主题保存后控件可用、保持键盘焦点及完整 2px 蓝圈。搜索、固定与 PDF 原件恢复专项均通过。最初诊断的焦点丢失、活动面板选择器失败、完整 325 项失败及精确源叠加均保留，不计为新版包内或分发通过。[搜索与草稿](../verification/settings-action-focus-search-review-result.json) · [PDF 恢复](../verification/settings-action-focus-mcp-pdf-review-result.json) · [原焦点诊断](../verification/settings-scroll-heading-surfaces-focus-diagnostic-failure-result.json)

上一搜索包首轮完整失败保留 379 张新原图、9 份当轮原始报告、精确源码、显式退出回执及压缩现场。当时的 18 张设置原图逐张复核，不能替代完整回归；失败时尚未写出该轮独立设置报告，旧报告排除。84.6 MB 现场副本的上游专项 5 项通过，四次正常退出／最长 369ms；诊断仅记录重命名时序和超时后的状态，原 5 秒预算、断言与旧应用体不变。此前 76／306／296／312／325 项后的失败均保留；当前完整 361 项通过，不据此认定历史上游超时的唯一原因已确定。[312 项失败现场](../verification/settings-search-sidebar-full-unpacked-initial-failure-result.json) · [旧包 18 张原图](../verification/settings-search-sidebar-packaged-originals-result.json) · [现场副本重放](../verification/settings-search-sidebar-upstream-seed-replay-result.json)

剩余工作包括全部参考流程、原生向导／选择器、物理输入与辅助技术，以及真实服务和目标平台检查。完成后直接走原发布流水线，无需再次确认。[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md)
