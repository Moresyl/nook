# Nook 发布状态

**尚未发布。** Windows x64 候选为 `0.1.0-alpha.1`。项目、图标和产品说明统一为 **Nook**，原始开源许可证完整保留。界面依据最新 `E:\txt` 资料持续完善，尚未达到全部页面 100% 还原。

[设置原生检查](../verification/settings-search-native-review-result.json) · [18 张设置原图](../verification/settings-search-originals-review-result.json) · [1,514 项单元](../verification/settings-search-unit-review-result.json)

| 验证 | 当前结果 |
| --- | --- |
| 完整单元 | 当前完整 130 文件／1,515 项通过，376.72 秒；语句 96.92%、分支 94.43%、函数 97.69%、行 99.41%；单 worker 与四项 80% 门槛保留 |
| 类型与构建 | 当前搜索外观与 Windows 应用标识的类型、针对性 111 项单元及构建通过；新包待构建 |
| 设置搜索 | 当前 36px 胶囊外观的 6 项源码原生检查通过，393ms 正常退出；18 张明暗缩放原图逐张复核；根目录专项 10 项、三次正常退出／最长 557ms |
| 包体审计 | 前一设置包 `47f910d`：239 个产品文件、401 份法律文件、20 份分发许可来源，无未解决项且未签名；外观和应用标识修改后的新包待重验 |
| 完整包内回归 | 前一设置包分别在 76、306、296 项后失败；已保留现场并修正测试的保留表单假设和异步目录就绪等待，原断言和期限保留；当前完整门槛为 361 项 |
| 同包分发专项 | 当前源码改变应用体，分发专项待同包重验 |
| 视觉复核 | 当前 18 张搜索原图逐张检查，完整蓝色搜索焦点圈可见；其他专项及历史原图按各自应用体记录 |
| 实际安装 | 新应用标识与完整 361 项待验；原 8 个数据标记哈希已重新核对，尚未移动 |
| 同包运行记录 | 当前新包须重新完成原 11 份匹配记录，旧包记录不计为新版通过 |
| 托管流水线 | 最近取证提交 `262909e` 已推送；GitHub 因账户付款／支出额度限制未开始验证，没有已发布版本 |

上一完成分发验收的应用体来自 `cf22dd0`。该包完整回归、实际安装与分发专项的 236 个编译文件均匹配审计包，安装登记、快捷方式及保留数据卸载已核验。新增设置搜索改变了应用体，旧记录不作为新版通过凭据；完整发布门槛保留原条件，并增加设置搜索至至少 361 项。新版完整包内、实际安装与分发待重验，安装原生向导仍是独立待验项。[上一包体](../verification/worktree-pin-focus-package-review-result.json) · [上一包 355 项回归](../verification/worktree-pin-focus-packaged-native-review-result.json) · [上一包实际安装](../verification/worktree-pin-focus-installed-native-review-result.json) · [上一包便携](../verification/worktree-pin-focus-portable-review-result.json)

快速聊天保存已接入绑定原文件版本的小型检查点，保留独立草稿、完整前一版本备份与重启恢复。结构改变、外部替换或达到原有 8 MB 上限时完整保存。大历史默认专项 9 项与 28 张原图复核通过；完整包内回归也通过该段，不据此承诺全部延迟。[完整单元](../verification/quick-chat-journal-full-unit-retry-review-result.json) · [大历史重放](../verification/quick-chat-journal-large-history-replay-review-result.json)

固定操作完成后，控件在恢复可用时回焦并滚动完整操作区域。原六组专项通过，两主题三档缩放下的完整错误和蓝色键盘边框均逐张确认。[固定专项](../verification/worktree-pin-focus-native-review-result.json) · [21 张原图](../verification/worktree-pin-focus-originals-review-result.json)

当前包的无项目空列表另通过六组原生检查与六张原图复核。标题、说明和完整正文在两主题三档缩放下可见，状态保持、无外部请求和正常退出均核实；不将其扩大为全部参考页面验收。[空列表原图](../verification/worktree-pin-focus-empty-overview-originals-review-result.json)

工作树支持项目登记、关联聊天、本机固定、私有快照、新目录恢复及保存快照后的安全删除。自动清理默认关闭，保留数量为 1～50；固定聊天、正在运行的回复／终端、草稿、锁定或含改动目录均受保护。外部与身份变化目录无删除权限；私有快照最多 100 份，保存失败或达到上限时停止清理。应用内排他不等于外部文件进程加锁。

此前两次旧包 247 项后失败、新检查点包 308／321 项后失败、登记原样重放及新增大文件测试默认超时，均保留完整现场与原断言。仅新增单项使用 10 秒聚合预算；原启动 30 秒、关闭 10 秒、持有操作 5 秒、桥接 10 秒及快速聊天 5 秒不变。全部历史说明已逐字存档于[检查点阶段记录](RELEASE-HISTORY-2026-10-12-QUICK-JOURNAL.md)。

最近取证的托管运行 [38194102286](https://github.com/Moresyl/nook/actions/runs/38194102286) 对应 `262909e`，验证为零步骤失败，实际注释为近期付款失败或支出额度受限；分支发布按仅标签条件跳过。未调整账户计费、替换执行器或绕过发布门槛。此前冻结包的托管记录仍保留为历史证据。

剩余工作包括全部参考流程、原生向导／选择器、物理输入与辅助技术，以及真实服务和目标平台检查。完成后直接走原发布流水线，无需再次确认。[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md)
