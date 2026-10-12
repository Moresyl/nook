# Nook 发布状态

**尚未发布。** Windows x64 候选版本为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 **Nook**，原始开源许可证保留。已授权验收完成后直接通过原流水线发布，无需再次确认。

最新输入区快捷选择已完成源码回归：主工作台与快速聊天共用 `/` 筛选，模板在光标处插入，取消保留原文；选择助手或项目不发送消息。[使用说明](COMPOSER-ACTIONS.md)

| 当前验证 | 实际结果 |
| --- | --- |
| 类型与构建 | 通过；236 个编译文件与原生验收逐文件匹配 |
| 相关单元 | 135 项通过 |
| 完整单元与覆盖率 | 131 文件／1,533 项通过；语句 96.94%、分支 94.48%、函数 97.71%、行 99.42% |
| 快捷选择专项 | 七项通过，无模型请求；明暗主题各三档应用缩放 |
| 完整源码回归 | `e70d4c63`：368 项、74 次正常退出、最长 1,742ms，无强制结束 |
| 本轮证据 | 39 份新报告、548 张原图；其中 12 张完整 760×540 快捷菜单原图逐张检查，其他原图未全部视觉复核 |
| 新包、实际安装及分发 | 待完成；原五个分发专项、安装／卸载及十一份匹配运行记录继续必需 |
| 托管流水线 | 最新本地提交尚未推送；此前运行因账户付款／支出额度限制，验证零步骤失败、发布跳过 |

[源码专项与单元证据](../verification/composer-actions-acceptance-review-result.json) · [完整源码回归与本轮原图](../verification/composer-actions-full-source-review-result.json)

完整回归此前四轮失败及原始目录均独立保留。同名助手和保留旧模型选择的测试定位已修正；快捷菜单方向键等待曾持续超时，增加事件诊断后的本轮通过，但原失败原因尚未确认，不能把重放通过写成已修复。原等待期限和断言保留。[同名选项复测](../verification/composer-actions-integration-retry-review-result.json) · [模型选择复测](../verification/quick-chat-retained-model-integration-review-result.json) · [键盘同步复测](../verification/composer-actions-keyboard-integration-review-result.json) · [键盘事件诊断](../verification/composer-actions-keyboard-diagnostic-review-result.json)

界面依据最新版 `E:\txt`（26.930.41038／build 13022）逐项采用，**尚未达到全部页面与交互 100% 对齐**。当前快捷浮层宽度上限 420px，与参考静态 520px 有差异；合法 Inter／系统中文字体及独立品牌也保留差异。物理输入、系统 DPI、无障碍、真实服务及其他目标平台仍需各自验收。[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md)

此前 `25254c839` 冻结包已通过本机分发，结果只属于该旧应用体；最后已核对的托管运行 [38272492271](https://github.com/Moresyl/nook/actions/runs/38272492271) 属于 `d42376dd`，受账户付款／支出额度限制，仓库版本列表为空。最新提交推送后需读取其精确运行结果。

整理前的全部记录逐字保留在[本轮发布历史](RELEASE-HISTORY-2026-10-13-COMPOSER-INTEGRATION.md)，原 SHA-256 为 `1213161738d3c0d420930480385dbe2ef9554255e3bacd1ebf2d66a79591a394`。历史包含旧包验收、原图范围、存储转换、失败及其链接；这次整理未取消剩余要求。
