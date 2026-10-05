# Nook 发布状态

**尚未发布。** 用户已授权完成后直接走流水线，无需再次确认。仓库：[Moresyl/nook](https://github.com/Moresyl/nook)；候选版本：`0.1.0-alpha.1`，Windows x64，当前未签名。

## 当前候选包

源码 `015980c` 已重新生成安装版与便携版，包含脚本加载前的启动占位和首次读取失败的恢复入口。包体／法律审计、安装器／卸载器／便携启动器审计及打包版设置专项 4 项通过；专项还检查了启动占位、持久错误、真实重新加载和已保存草稿恢复。文件仍未签名。

实际便携运行 7 项通过：中文路径、真实终端、两次解压启动、正常退出清理、持久配置保留及现有登记／快捷方式保持。新包摘要与日志哈希见[本批分发记录](../verification/startup-distribution-result.json)。

| 文件 | 新包 SHA-256 |
| --- | --- |
| Nook.exe | `b4c228f638ca4c7911ec72ed3f36cccfe2175b6dd79c9460a766f116b5906592` |
| app.asar | `799488bc9e438ed118da628937dbc7080c198823959b28e5ed5596d64f52039d` |
| Nook-Setup | `8b4a3f2d7724f2134a94a0033db5da60717848562db8c541423fb896d461cc6e` |
| Nook-Portable | `0ca9ab6cee5ded3ef151a3a9256923b20ed64e7028ca8263cfa308d7cf8e118f` |

**本批尚未完成新的未安装／实际安装完整回归、安装卸载生命周期及全部匹配运行证据。** 下方完整 215 项等结果属于上一批；不能据此发布新包。新包证据见[包体审计](../verification/package-audit-result.json)、[启动器审计](../verification/distribution-bootstrap-result.json)和[打包版界面](../verification/surfaces-packaged-result.json)。

## 上一批完整验收记录（历史）

本节只描述 `4296faf` 应用体；可变名称的验证文件已开始被新批次更新，请使用[固定历史版本中的原始链接](https://github.com/Moresyl/nook/blob/015980c13d96a8bb959bdc42d464360935cdef43/docs/RELEASE.md)查阅旧包全部记录。

源码 `4296faf` 已生成安装版和便携版，包含弹窗视口位置、选择器高亮、开关开启色及共享按钮／图标提示。应用实现与已通过完整源码回归的 `3de4c5d` 一致。

后续源码加入了脚本加载前的启动占位，类型、构建及设置专项通过，详见[专项记录](../verification/startup-fallback-result.json)。下方历史包不包含此改动；旧包的完整通过记录不能作为最新源码的分发验收。

后续源码也补齐了首次读取失败的持久提示与重新加载入口，隔离失败／重试／已保存草稿恢复及设置专项通过，见[恢复记录](../verification/startup-recovery-result.json)。此改动同样不在下方历史包内。

| 文件 | SHA-256 |
| --- | --- |
| Nook.exe | `457897ffd6b0207db70ea42f5521ce56159af79f15e46ad490cea7abe8bfc476` |
| app.asar | `ccff8f562cd71c95440c4cd51463ec4c4c9704613dc73c3dfc1e4cc5acddd9c8` |
| Nook-Setup | `0f987ad53863b80ee17904e6588d8872db6b206ffc3783034a4d820a36fc043f` |
| Nook-Portable | `934e3f75e8ed2b016e62a02fc18e00fbbaa41d858f3648cd61ee99b7ef46328f` |

| 检查 | 当前证据 |
| --- | --- |
| 源码 | 类型、构建和完整桌面 215 项通过，无运行时错误、正常退出；[本批记录](../verification/shared-button-full-result.json) |
| 包体与法律文件 | 233 份产品文件、188 份解包文件、381 个依赖版本、401 份依赖法律文档及 20 份分发法律／来源文件；编译内容与构建一致，产品旧身份匹配为空；[包体审计](../verification/package-audit-result.json) |
| 启动器 | 安装器／卸载器／便携启动器分别 6／5／2 项通过；[原生组件记录](../verification/distribution-bootstrap-result.json) |
| 打包版界面 | 设置专项 4 项通过，覆盖明暗、七组窗口／缩放、新提示及草稿保留；[界面记录](../verification/surfaces-packaged-result.json) |
| 便携版 | 实际运行 7 项通过；中文长路径、真实终端、两次启动正常退出、配置保留和解压清理；[便携记录](../verification/portable-result.json) |
| 未安装包完整回归 | 2026-10-05 14:01 UTC 完整 215 项通过，无运行时错误、正常退出；[本批记录](../verification/shared-controls-packaged-full-result.json) |
| 实际安装与卸载 | 2026-10-05 14:20 UTC 完成 215 项、登记／快捷方式及正常卸载，四份测试用户数据保留；[安装结果](../verification/pipeline-installer-result.json) |
| 运行证据一致性 | 十份记录均匹配本批应用体；[分发摘要](../verification/shared-controls-distribution-result.json) |
| 安装版界面查看 | 七张实际安装截图已逐张查看并保存对应哈希；[界面记录](../verification/installed-ui-review-result.json) |

旧包的通过记录不能代替本批结果。安装包审计确认 EXE 为 `NotSigned`；构建日志里的签名步骤不代表文件已签名。

## 外部阻挡与未验证边界

已核实的托管运行 [37317589323](https://github.com/Moresyl/nook/actions/runs/37317589323)（`4296faf`）在 4 秒内失败，**没有启动验证步骤，发布被跳过**。GitHub 明确提示近期付款失败或需要提高支出上限；需要账号侧恢复 Actions 可用额度，没有修改付费设置。较早的同类原始提示见[计费阻挡记录](../verification/hosted-billing-37301247924.json)。

此前托管 Windows 还出现过[实际安装后的启动读取超时](https://github.com/Moresyl/nook/actions/runs/37288288085)及[模型比较回复等待超时](https://github.com/Moresyl/nook/actions/runs/37295798072)。后续本地修正和通过不能证明这些云端故障已经消除；仍需最终源码的完整托管成功。诊断边界见[启动与保存诊断](CI-STARTUP.md)。

原生 Computer Use 管道最近复查仍不可用。真实静默安装和 Electron 自动化不替代安装向导、系统选择器、物理输入、完整无障碍、真实云服务及其他目标平台验收。

## 发布前仍需完成

1. 按[交付要求](DELIVERY.md)、[能力记录](CAPABILITIES.md)与[设计对照](DESIGN-ALIGNMENT.md)完成剩余能力、参考页面和控件状态验收，不能以现有测试数量代替完整范围。
2. 恢复托管验证，确认最终源码通过全部门槛；完成原生系统交互、真实服务及目标平台检查。后续代码改动须重新验证对应应用体。
3. 检查前一版本、更新记录和实际提交，生成具体中英文更新说明、准确标签源码与 SHA-256，通过标签流水线发布并核验下载文件。

## 历史记录

之前的应用体、日志哈希和失败过程保存在[本次打包前的发布状态](https://github.com/Moresyl/nook/blob/4296faf848bbf5ccf8eab6638b8c0c801744afb3/docs/RELEASE.md)、[早期发布记录](RELEASE-HISTORY-2026-10-05.md)及[后续历史批次](RELEASE-HISTORY-2026-10-05-0915.md)。其中的“当前”、文件哈希和验收结果仅属于对应批次。
