# 无人值守桌面验收的渲染调度

云端 `37235418909` 的审批拒绝点击在原有 30 秒期限失败：按钮已被识别为可见、可用且稳定，Playwright 停留于滚动到可见位置。失败后的 1280×840 截图显示完整审批窗口和操作区，应用随后以退出码 0 正常退出。此次没有确认实际指针事件送达，也没有确认具体渲染阻塞原因。见 [原始失败证据](../verification/hosted-approval-scroll-failure-result.json)。

桌面检查器手动启动 Electron，再通过 CDP 连接，原先没有采用 Playwright 自带 Electron 启动器的渲染调度参数。项目锁定的 Playwright 1.63.0 在 `playwright-core/lib/server/electron/loader.js` 与 Chromium 默认启动配置中都设置以下三项：

- `--disable-background-timer-throttling`
- `--disable-backgrounding-occluded-windows`
- `--disable-renderer-backgrounding`

检查器现在对齐这三项，并在每次启动后确认它们存在于该测试进程的命令行中。它们用于避免无人值守、被遮挡窗口的后台调度影响自动化操作；产品正常启动、安装器和便携启动器的默认参数不变。未采用强制点击、DOM 点击、扩大点击期限或跳过拒绝／停止断言。

这属于测试环境配置对齐，不证明上一轮云端失败的确切根因已经找到。原默认参数的应用已通过完整源码和本地实际分发；新的自动化配置仍需独立的完整桌面及云端验收。物理原生交互也仍是独立范围。

本地首次临时聊天专项在后台分支已创建、界面尚未切换完成时填写了输入，后续切换恢复空草稿，发送按钮保持禁用。原失败日志保留。检查器现在先等待该分支的实际标题显示，再填写并断言原输入；这与后台持久状态检查互为补充。调整后六项专项通过，保留三次真实模型请求、临时内容隔离、完整备份排除、普通草稿恢复及正常重启；三次启动均验证上述参数生效。见 [专项证据](../verification/renderer-scheduling-component-result.json)。
