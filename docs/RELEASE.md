# Nook 发布状态

**尚未发布。** Windows x64 候选为 `0.1.0-alpha.1`。名称与说明统一为 **Nook**，原始开源许可证保留。最新设计资料为 `E:\txt`，全部参考页面与当前安装／便携分发验收仍需完成。

关闭自动清理时的保留数量说明、空列表标题与正文已按最新资料补齐，新构建及安装／便携包生成通过。包体审计核实 239 个产品文件、401 份法律文件与 20 份分发许可来源，身份和许可清单无未解决项。下方源码数字和清理原图属于此前已验收的基线，不提前计为本轮分发结果。[当前包体](../verification/worktree-cleanup-ui-package-review-result.json)

工作树支持集中列表、项目登记、关联聊天、本机固定、私有快照和恢复到新目录。新增安全删除和创建后自动清理：先持久保存可恢复快照，再删除符合条件的本机空闲工作树；保留源仓库和分支。固定、已登记、关联固定聊天、运行中的回复／终端、编辑草稿、锁定和含改动的目录均受保护。外部或身份变化的目录不取得删除权限。自动清理默认关闭，保留数量为 1～50；停用需要明确确认。

| 验证 | 已核实结果 |
| --- | --- |
| 类型与发布门槛 | 类型通过；101 项门槛测试通过；完整桌面最低数为 355 |
| 完整单元 | 129 文件／1,493 项通过；语句 96.88%、分支 94.34%、函数 97.68%、行 99.41%；原断言与时限不变 |
| 完整源码 | 355 项通过；74 次正常退出，最长 3,889ms；无强制关闭或运行时错误 |
| 清理补拍专项 | 10 组通过；7 次正常退出，最长 1,493ms；27 张原图逐张复核 |
| 应用体 | 236 个编译文件在完整源码与清理补拍轮完全一致 |
| 当前包内完整回归 | 两轮各通过 247 项后失败；首轮审批等待、复测首段回复等待分别超时；各 36 次正常退出，最长 3,734ms／3,382ms，无强制关闭；不能计为完整通过 |
| 当前快速聊天重放 | 同包专项 9 项通过；2 次正常退出，最长 299ms；28 张原图逐张复核，仅限专项范围 |
| 当前分发 | 完整包内回归、安装、便携、保留数据卸载及托管流水线尚未验收 |

完整源码保留 223 张选定原图，未将它们全部计为本轮视觉验收。清理补拍的 27 张已检查明暗两主题和三档缩放、完整错误与蓝色键盘边框、底部操作、固定行、自动清理完成状态及浅色目录替换保护；长路径和后续行仍需纵向滚动。先前快照 33 张与固定 21 张的复核有独立记录。

[完整源码](../verification/worktree-cleanup-full-native-review-result.json) · [清理补拍](../verification/worktree-cleanup-native-visual-followup-review-result.json) · [27 张原图范围](../verification/worktree-cleanup-visual-originals-review-result.json) · [完整单元复测](../verification/worktree-cleanup-final-unit-retry-review-result.json) · [门槛与类型](../verification/worktree-cleanup-gates-unit-review-result.json)

两次包内失败的源码、日志、完整资料目录、原始失败图和部分报告均已保留，236 个编译文件与已审计的新包一致。复测现场工作区约 84.6 MB；超时后原图已显示首段回复，正在测量草稿保存与请求启动，精确原因尚未确定。原来的 5 秒等待未更改，专项通过不代替完整通过。[首轮现场](../verification/worktree-cleanup-ui-packaged-native-initial-failure-result.json) · [复测现场](../verification/worktree-cleanup-ui-packaged-native-retry-failure-result.json) · [专项重放](../verification/worktree-cleanup-ui-quick-replay-review-result.json) · [28 张原图范围](../verification/worktree-cleanup-ui-quick-originals-review-result.json)

此前的嵌套页脚定位、隐藏开关点击测试失败和截图取证遗漏均保留。应用内操作排他不等于对外部文件进程加锁；Git 删除失败可能留下部分处理结果，已保存快照保留，应刷新检查后恢复到新目录。私有快照最多 100 份，达到上限或保存失败时停止清理。

快照和清理已合入交付分支并推送 `b275e43`。新托管运行 [38170454226](https://github.com/Moresyl/nook/actions/runs/38170454226) 仍因账户付款／支出额度限制而验证零步骤失败，分支发布按仅标签条件跳过；没有已发布版本。本地通过不能代替托管验收。[新运行证据](../verification/worktree-cleanup-hosted-result.json)

最终单元首轮 1,492 项通过、上游 held-fetch 队列测试在原 5 秒期限超时；原样专项 12 项通过后，完整复测 1,493 项通过，精确超时原因未确定。原失败、源码和日志保留。[首轮失败](../verification/worktree-cleanup-final-unit-initial-review-result.json) · [原样重放](../verification/worktree-cleanup-final-upstream-replay-review-result.json)

历史源码、失败现场和原始范围保留于[快照阶段记录](RELEASE-HISTORY-2026-10-12-SNAPSHOTS.md)、[固定阶段记录](RELEASE-HISTORY-2026-10-12-PINNING.md)和[验证历史](VALIDATION-HISTORY.md)。全部完成后直接走发布流水线，无需再次确认；要求见[交付要求](DELIVERY.md)。
