# Nook 发布状态

**尚未发布。** Windows x64 候选版本为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 **Nook**，原始开源许可证保留。已授权验收完成后直接通过原流水线发布，无需再次确认。

输入区快捷选择支持主工作台与快速聊天共用 `/` 筛选，模板在光标处插入，取消保留原文；选择助手或项目不发送消息。[使用说明](COMPOSER-ACTIONS.md)

最新修复补齐命令输出节流的最后一次通知：100 毫秒内到达的第二段输出，即使没有后续输出，也会更新执行中的记录；关闭、报错和取消后不会继续通知。旧实现的两个确定性回归测试失败，修正版六项时序测试及真实工具专项通过。`557cc83b` 包的完整验收在 355 项后等待第二段输出超时，72 次应用退出均正常；失败包、原目录、释放文件和截图完整保留。

| 当前验证 | 实际结果 |
| --- | --- |
| 类型与构建 | 通过；236 个编译文件与原生验收逐文件匹配 |
| 相关单元 | 命令、执行和工具记录 51 项通过 |
| 完整单元与覆盖率 | 132 文件／1,539 项通过；语句 97.02%、分支 94.57%、函数 97.77%、行 99.48% |
| 工具记录专项 | 八项通过；第二段输出、取消、原文复制、快速聊天和实际重启；两次正常退出 674ms／150ms |
| 完整源码回归 | 输出修复待完整回归；此前光标修复 `28c39234` 的 368 项／74 次正常退出只属于旧应用体 |
| 本轮证据 | 236 个新编译文件、17 份源码及测试文件匹配；九张工具原图逐张检查。浅色 150% 捕获未显示摘要控件，尚不接受为六组完整可见截图 |
| 新包、实际安装及分发 | 待完成；原五个分发专项、安装／卸载及十一份匹配运行记录继续必需 |
| 托管流水线 | 最新本地提交尚未推送；此前运行因账户付款／支出额度限制，验证零步骤失败、发布跳过 |

[输出修复与单元对照](../verification/command-progress-acceptance-review-result.json) · [当前包失败现场](../verification/composer-selection-focus-package-initial-failure-review-result.json) · [此前光标修复](../verification/composer-selection-focus-acceptance-review-result.json) · [此前完整源码](../verification/composer-selection-focus-full-source-review-result.json)

此前光标修复将助手／项目选择后的恢复绑定对应草稿与上下文的布局提交，避免覆盖用户随后全选的范围；旧包 `[0,5]`→`[5,5]` 与修正版保持 `[0,5]` 的受控原生对照保留。旧包 149 项后失败及四轮源码失败均不计入当前包验收。

完整回归此前四轮失败及原始目录均独立保留。同名助手和保留旧模型选择的测试定位已修正；快捷菜单方向键等待曾持续超时，增加事件诊断后的本轮通过，但原失败原因尚未确认，不能把重放通过写成已修复。原等待期限和断言保留。[同名选项复测](../verification/composer-actions-integration-retry-review-result.json) · [模型选择复测](../verification/quick-chat-retained-model-integration-review-result.json) · [键盘同步复测](../verification/composer-actions-keyboard-integration-review-result.json) · [键盘事件诊断](../verification/composer-actions-keyboard-diagnostic-review-result.json)

界面依据最新版 `E:\txt`（26.930.41038／build 13022）逐项采用，**尚未达到全部页面与交互 100% 对齐**。当前快捷浮层宽度上限 420px；参考 520px 属于居中命令对话框，尚不能直接等同锚定输入浮层。合法 Inter／系统中文字体及独立品牌保留差异。物理输入、系统 DPI、无障碍、真实服务及其他目标平台仍需各自验收。[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md)

此前 `25254c839` 冻结包已通过本机分发，结果只属于该旧应用体；最后已核对的托管运行 [38272492271](https://github.com/Moresyl/nook/actions/runs/38272492271) 属于 `d42376dd`，受账户付款／支出额度限制，仓库版本列表为空。最新提交推送后需读取其精确运行结果。

整理前的全部记录逐字保留在[本轮发布历史](RELEASE-HISTORY-2026-10-13-COMPOSER-INTEGRATION.md)，原 SHA-256 为 `1213161738d3c0d420930480385dbe2ef9554255e3bacd1ebf2d66a79591a394`。历史包含旧包验收、原图范围、存储转换、失败及其链接；这次整理未取消剩余要求。
