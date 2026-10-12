# Nook 发布状态

**尚未发布。** Windows x64 候选为 `0.1.0-alpha.1`。项目、图标和产品说明统一为 **Nook**，原始开源许可证完整保留。界面依据最新 `E:\txt` 资料持续完善，尚未达到全部页面 100% 还原。

| 验证 | 当前结果 |
| --- | --- |
| 完整单元 | 129 文件／1,505 项通过；语句 96.90%、分支 94.39%、函数 97.68%、行 99.41% |
| 类型与构建 | 当前固定回焦修正的类型、构建及安装／便携打包通过 |
| 包体审计 | 239 个产品文件、401 份法律文件、20 份分发许可来源；无未解决身份或许可项；可执行文件未签名 |
| 完整包内回归 | 355 项通过；74 次正常退出，最长 2,638ms；无强制关闭或运行时错误 |
| 同包分发专项 | 控件 4 项、文字提示 7 项、窗口关闭 2 项、三种启动器审计、便携 7 项全部通过；便携实际启动两次 |
| 视觉复核 | 当前固定专项 21 张、控件 24 张、文字提示 12 张、列表 18 张、空列表 6 张原图逐张检查；完整轮其他原图仅保留 |
| 实际安装 | 完整 355 项通过；74 次正常退出，最长 2,341ms；卸载保留数据通过，原 8 个标记恢复且哈希一致 |
| 同包运行记录 | 原 11 份匹配记录校验通过，安装／未安装／便携应用体与启动器哈希一致 |
| 托管流水线 | 当前提交已推送；GitHub 因账户付款／支出额度限制未开始验证，没有已发布版本 |

当前应用体来自 `cf22dd0`。完整包内回归、实际安装与各分发专项的 236 个编译文件均匹配审计包；安装登记、快捷方式、保留数据卸载及正常退出已核验。安装原生向导仍是独立待验项。[包体](../verification/worktree-pin-focus-package-review-result.json) · [355 项回归](../verification/worktree-pin-focus-packaged-native-review-result.json) · [实际安装](../verification/worktree-pin-focus-installed-native-review-result.json) · [便携](../verification/worktree-pin-focus-portable-review-result.json)

快速聊天保存已接入绑定原文件版本的小型检查点，保留独立草稿、完整前一版本备份与重启恢复。结构改变、外部替换或达到原有 8 MB 上限时完整保存。大历史默认专项 9 项与 28 张原图复核通过；完整包内回归也通过该段，不据此承诺全部延迟。[完整单元](../verification/quick-chat-journal-full-unit-retry-review-result.json) · [大历史重放](../verification/quick-chat-journal-large-history-replay-review-result.json)

固定操作完成后，控件在恢复可用时回焦并滚动完整操作区域。原六组专项通过，两主题三档缩放下的完整错误和蓝色键盘边框均逐张确认。[固定专项](../verification/worktree-pin-focus-native-review-result.json) · [21 张原图](../verification/worktree-pin-focus-originals-review-result.json)

当前包的无项目空列表另通过六组原生检查与六张原图复核。标题、说明和完整正文在两主题三档缩放下可见，状态保持、无外部请求和正常退出均核实；不将其扩大为全部参考页面验收。[空列表原图](../verification/worktree-pin-focus-empty-overview-originals-review-result.json)

工作树支持项目登记、关联聊天、本机固定、私有快照、新目录恢复及保存快照后的安全删除。自动清理默认关闭，保留数量为 1～50；固定聊天、正在运行的回复／终端、草稿、锁定或含改动目录均受保护。外部与身份变化目录无删除权限；私有快照最多 100 份，保存失败或达到上限时停止清理。应用内排他不等于外部文件进程加锁。

此前两次旧包 247 项后失败、新检查点包 308／321 项后失败、登记原样重放及新增大文件测试默认超时，均保留完整现场与原断言。仅新增单项使用 10 秒聚合预算；原启动 30 秒、关闭 10 秒、持有操作 5 秒、桥接 10 秒及快速聊天 5 秒不变。全部历史说明已逐字存档于[检查点阶段记录](RELEASE-HISTORY-2026-10-12-QUICK-JOURNAL.md)。

最新托管运行 [38182581788](https://github.com/Moresyl/nook/actions/runs/38182581788) 的验证为零步骤失败，分支发布按仅标签条件跳过。未调整账户计费、替换执行器或绕过发布门槛。[运行证据](../verification/worktree-pin-focus-hosted-review-result.json)

剩余工作包括全部参考流程、原生向导／选择器、物理输入与辅助技术，以及真实服务和目标平台检查。完成后直接走原发布流水线，无需再次确认。[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md)
