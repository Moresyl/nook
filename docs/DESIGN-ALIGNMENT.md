# Nook 设计对照

界面以 `E:\txt` 的新版资料为依据（26.930.41038／构建 13022）。主题、控件和布局已逐步采用，**尚未达到全界面 100% 还原**。静态 CSS、字符串数量与历史截图不能代替当前应用的实际验收。

| 表面 | 已采用 | 仍需完成 |
| --- | --- | --- |
| 主题与控件 | 中性灰与蓝色强调、明暗主题；共享按钮、输入、下拉框、开关、焦点和文字提示 | 每页的全部状态、复杂表单、物理辅助技术与真实系统缩放 |
| 首页与对话 | 大输入区、展开式输入、附件、消息导航、查找、工具记录和用量 | 更复杂输入配置、最大规模内容及全部参考流程 |
| 侧栏与项目 | 264px 常规／64px 紧凑导航、项目文件树、编辑器、终端和并排预览 | 更多复杂工作区、完整图标对照与跨平台操作 |
| 工作树 | 根目录、上游刷新、集中列表、关联聊天、项目登记、固定、私有快照、新目录恢复、安全删除和自动清理；六组空状态原图已核验 | 独立仓库／会话加载状态与参考存在差异 |
| 设置与弹窗 | 共享间距、视口适配、键盘焦点、独立正文滚动与可见页脚；关闭自动清理的数量说明和空列表文案已补齐 | 所有分类、长表单、原生目录选择器与安装向导 |
| 文档与图片 | 离线 PDF 阅读、目录、搜索、链接和批注；图片缩放、切换与键盘操作 | 更多真实中文／图像样本、复杂格式、触屏与完整产物流程 |
| 快速聊天 | 独立窗口、共享控件、收起栏、独立草稿、受限桥接和 PDF 阅读；当前完整安装回归通过 | 全部参考流程与最大规模内容 |
| 浏览器 | 独立标签、导航、失败重试、快捷键与草稿保留 | 历史、下载、网站权限、自动化及完整参考布局 |
| 字体与品牌 | Nook 名称、独立图标、合法分发的 Inter 和系统中文字体 | 与参考字体和品牌存在明确差异；不能宣称逐像素一致 |

工作树清理基线已通过 355 项完整源码检查及 74 次正常退出。清理补拍的 27 张原图逐张复核，覆盖两种主题、三档缩放、错误、焦点与页脚；长路径和后续行仍需滚动。完整源码保留的 223 张选定原图没有全部计入视觉验收。

快速聊天检查点与固定回焦修正已重新构建并生成安装／便携包；审计核实 239 个产品文件、401 份法律文件与 20 份分发许可来源。完整单元 1,505 项通过；大历史默认快速聊天专项九项通过，28 张当前原图逐张复核。旧包的两次 247 项失败和检查点包的 308／321 项失败均保留原时限与现场。

当前修正包的未安装与实际安装完整回归各 355 项通过、各 74 次正常退出，最长分别 2,638ms 与 2,341ms；236 个编译文件与审计包一致。固定专项 21 张、控件 24 张、文字提示 12 张及工作树列表 18 张原图已逐张复核。六组明暗缩放的固定错误与键盘边框可见；列表早期六张虽带浅色文件名，实际为深色，按实际画面记录。空列表另补六组原生检查与六张原图，完整标题和正文均可见；大缩放仍需滚动。完整轮其余原图没有全部计入视觉验收。便携、启动器、保留数据卸载及原 11 份匹配运行记录校验通过；原生向导、全部参考采用及托管发布仍待完成。

[当前固定原图](../verification/worktree-pin-focus-originals-review-result.json) · [控件原图](../verification/worktree-pin-focus-surfaces-originals-review-result.json) · [文字提示原图](../verification/worktree-pin-focus-text-hints-originals-review-result.json) · [列表原图](../verification/worktree-pin-focus-overview-originals-review-result.json)

[空列表原生检查](../verification/worktree-pin-focus-empty-overview-review-result.json) · [六张空列表原图](../verification/worktree-pin-focus-empty-overview-originals-review-result.json) · [实际安装与保留数据](../verification/worktree-pin-focus-installed-native-review-result.json)

[清理原图范围](../verification/worktree-cleanup-visual-originals-review-result.json) · [包体审计](../verification/worktree-cleanup-ui-package-review-result.json) · [包内首轮失败](../verification/worktree-cleanup-ui-packaged-native-initial-failure-result.json) · [包内复测失败](../verification/worktree-cleanup-ui-packaged-native-retry-failure-result.json) · [快速聊天重放](../verification/worktree-cleanup-ui-quick-replay-review-result.json) · [28 张原图范围](../verification/worktree-cleanup-ui-quick-originals-review-result.json)

固定设备缩放的测试与真实 Windows 系统缩放分开记录。此前系统 125% 下的设置和首页各有 13 项专项、13 张原图，不能据此认定其他页面、显示器或全部缩放通过。

此前逐批实现、失败现场、截图表格与未完成范围完整保留于[设计验收历史](DESIGN-ALIGNMENT-HISTORY-2026-10-12.md)。正文整理没有取消其中的交付要求。详细控件见[控件对照](CONTROL-AUDIT.md)，功能范围见[能力与边界](CAPABILITIES.md)，当前交付见[发布状态](RELEASE.md)。
