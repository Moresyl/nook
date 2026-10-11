# Nook 发布状态

**尚未发布。** 当前候选为 Windows x64 `0.1.0-alpha.1`。名称、图标、仓库说明与更新记录已整理；开源许可证继续保留。最新设计资料使用 `E:\txt`，完整界面采用与分发验收尚未完成。

## 当前功能与验证

工作树支持新建／已有分支、默认目录、创建前刷新上游、集中列表、项目登记、关联会话及本机固定状态。应用实际创建后才保存独立创建记录；普通登记不采纳外部工作树。写入失败保留文件和旧状态，目录被移动或替换时禁用旧管理入口；创建记录与固定状态不进入共享备份。

| 验证 | 已核实结果 |
| --- | --- |
| 类型与发布门槛 | 类型通过；88 项门槛测试通过，最低完整桌面数提高至 337 |
| 完整单元 | 121 文件／1,358 项通过；语句 97.35%、分支 95.16%、函数 97.53%、行 99.42% |
| 固定桌面专项 | 六组通过、五次正常退出，最长 993ms；236 个编译文件与首轮一致 |
| 固定原图 | 整轮当前 21 张逐张复核；两主题三档缩放中提交前及失败后的键盘边框与错误完整可见 |
| 前序完整源码 | 创建记录版本 331 项、60 次正常退出，最长 2,215ms；22 张相关原图逐张复核 |
| 当前完整源码／分发 | 重新运行整轮 337 项通过；64 次正常退出，最长 2,121ms；当前分发尚待验收 |

覆盖率仅统计契约与主进程服务，沿用四项 80% 门槛和排除范围；React 界面另由桌面检查覆盖。固定专项使用实际 Git、原子写入 EIO、来源变更、损坏记录、gzip 恢复和正常重启。首轮读取错误截图没有显示提示，原图和限制保留；纠正截图后重新通过六组检查。第二轮暗色 150% 错误图未显示焦点的限制仍保留；337 项整轮增加失败后实际焦点等待，六种主题／缩放的完整蓝色边框与错误均通过断言及当前原图复核。236 个编译文件与专项一致；163 张选定原图保留，其中固定的 21 张在本轮逐张复核。

整轮首轮快速聊天的旧快照等待检查超过原有五秒期限，245 项通过后停止；36 次退出均正常（最长 2,545ms）。完整失败现场保留。使用该工作区共享状态重放九项通过、两次正常退出（最长 424ms），产品编译体和期限未改变；超时根因尚未确定，专项通过不代替整轮通过。[失败现场](../verification/worktree-pinning-source-failure-result.json) · [快速聊天重放](../verification/worktree-pinning-quick-replay-result.json)

重跑整轮通过原刷新检查，实际诊断记录显示深色新快照先返回、浅色旧快照后返回，界面与草稿保留新状态。整轮固定子报告的写入器错误保留了「专项」标签且遗漏总数；原报告不改写，完整 Electron 报告与 337 项日志及相同的嵌入数据证明六组实际执行。写入器已按其他模块的既有模式修正，下次运行验证新标签。[完整源码与报告限制](../verification/worktree-pinning-full-review-result.json) · [整轮原图范围](../verification/worktree-pinning-full-originals-review-result.json)

[完整单元与范围](../verification/worktree-pinning-unit-review-result.json) · [固定专项](../verification/worktree-pinning-notice-review-result.json) · [当前原图](../verification/worktree-pinning-notice-originals-review-result.json) · [首轮图像限制](../verification/worktree-pinning-originals-review-result.json) · [前序整轮源码](../verification/worktree-ownership-full-review-result.json) · [前序原图范围](../verification/worktree-ownership-full-originals-review-result.json)

## 流水线

固定整轮证据已随 `fc680b7` 推送；[38155087287](https://github.com/Moresyl/nook/actions/runs/38155087287) 未启动验证，GitHub 注释明确指出账户付款／支出额度限制。验证失败、分支发布按仅标签条件跳过，均为零步骤。未创建发布标签或已发布版本；本地通过不能代替托管验收。[当前精确运行与注释](../verification/worktree-pinning-hosted-result.json) · [前序创建记录运行](../verification/worktree-ownership-hosted-result.json)

## 继续完成

1. 补齐快照／恢复、安全清理及其他参考页面和状态；不加入无执行行为的设置开关。
2. 冻结同一应用体后完成未安装、实际安装、便携、原件恢复、正常退出及保留数据卸载的全面多轮验收。
3. 托管验证通过后直接走标签流水线，核对中英文更新说明、源码、下载文件与 SHA-256，无需用户再次确认。

完整要求见[交付要求](DELIVERY.md)。此前各版本的结果、失败现场、修正和剩余验收原文保留于[创建记录阶段历史](RELEASE-HISTORY-2026-10-11-OWNERSHIP.md)，更早记录继续沿用其中的链接；历史通过仅证明各自的源码和应用体。
