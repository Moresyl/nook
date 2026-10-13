# Nook 发布状态

**尚未发布。** 当前 Windows x64 候选版本为 `0.1.0-alpha.1`。名称、图标和产品说明统一为 Nook；原始开源许可证与来源声明保留。最终验收通过后按原流水线发布，已获授权，无需再次确认。

## 当前应用体

输入框采用最新版设计资料的 **22px 默认圆角**；CSS 视口小于 40rem 时，浅色大阴影范围由 80px 收至 40px。编译来源为 `177ad10`，完整桌面测试来源为 `9f50a58`；后者只将过时的 24px 测试期望修正为 22px，产品与 236 个编译文件不变。

| 检查 | 已验证结果 |
| --- | --- |
| 类型与构建 | 本轮实际通过；保留准确源码和 236 个编译文件 |
| 首页原生专项 | 13 项、两次正常退出；两种主题、两种尺寸、三档应用缩放，13 张原图逐张复核 |
| 完整源码桌面回归 | 375 项、74 次正常退出，无强制结束；最长正常退出 1,712ms |
| 完整原始证据 | 39 份新报告、617 张原图、完整工作区；617 张未全部逐张视觉复核 |
| 单元覆盖率依据 | 此前 1,557 项通过的生产逻辑基线；本轮 CSS 改动没有冒充新一轮单元测试 |

首页专项实际系统缩放为 100%，没有强制设备缩放。完整源码套件保留原精确尺寸夹具和全部期限；它不能替代其他实际系统 DPI、物理交互与真实服务验收。

[构建证据](../verification/composer-surface-tokens-build-review-result.json) · [首页专项](../verification/composer-surface-tokens-native-review-result.json) · [完整源码](../verification/composer-surface-tokens-full-source-review-result.json)

首轮完整源码因旧圆角断言失败，实际退出 1；原日志、24 张截图、工作区及准确编译文件均保留。修改测试期望后重跑通过。归档助手另曾使用错误的报告文件名，在复制前退出 1；已按原验证器修正并保留记录，没有重写产品或降低验收条件。[首轮失败现场](../verification/composer-surface-tokens-full-source-failure-review-result.json)

## 分发与发布

前一冻结记忆弹窗应用体已完成源码、未安装程序、实际安装程序三轮 375 项，以及原五个分发专项、便携七项、快捷方式与保留数据卸载。**这些记录属于前一应用体；当前输入框改动后的安装与便携包仍须重新验收。** 前一候选未签名。

[前一完整分发](../verification/memory-delete-default-surface-runtime-review-result.json) · [安装后回归](../verification/memory-delete-default-surface-full-installed-review-result.json)

原托管流水线最近核对的提交为 `844c33d`：[运行 38402974905](https://github.com/Moresyl/nook/actions/runs/38402974905)。验证作业因账户付款／支出额度限制在零步骤时失败，发布作业跳过。浏览器连接还返回认证令牌不可用，页面未打开。尚无发布标签或可下载版本；成功发布必须有真实流水线和产物核对。

## 剩余交付

- 补齐当前应用体的安装、便携和分发回归。
- 逐项完成新版设计资料的页面、状态与交互对照；尚不能宣称 100% 采用。
- 完成实际系统 DPI、物理交互、无障碍和真实服务的相应验收。
- 通过原标签流水线，核对下载文件、准确源码、法律文件、SHA-256 和具体中英文版本说明。

[设计对照](DESIGN-ALIGNMENT.md) · [能力与边界](CAPABILITIES.md) · [完整交付要求](DELIVERY.md) · [界面验收](UI-ACCEPTANCE.md)

此前完整发布说明逐字保留于[历史记录](RELEASE-HISTORY-2026-10-13-COMPOSER.md)，SHA-256 为 `1e09973e261edeccd78950612bf1164beaee4859df9895a954a3f99cbf0da9d0`。历史失败、旧原图和验收要求继续保留。
