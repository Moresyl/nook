# Nook 设计对照

界面以最新版 `E:/txt`（26.930.41038／build 13022）的作用域 CSS、主题和实际调用证据为依据。旧 `DESIGN.md` 只作历史索引。**全部页面与交互尚未达到 100% 对齐。**

最新记忆删除保留 520px／92vw、20px 圆角与独立滚动，并修正默认调用的字体、顶部定位和表面：全局半粗为 600，590 仅属于目录弹窗局部变量；对话框标题的正常字距覆盖基础 -0.36px。默认定位只水平居中，顶部按可用高度计算。表面采用 90% 非扩展回退色、0.5px 边缘、24px 模糊与默认遮罩，关闭控件为 32px。参考运行时可注入其他表面变量，未宣称其最终颜色唯一确定；长内容安全高度仍属本产品补充。新样式验收待完成。

此前记忆样式的五组原生专项、六组应用缩放、22 张原图复核以及完整源码 375 项／74 次正常退出通过；这些证据保留，但不能证明新样式通过或完整参考采用。共享字体／品牌、全部调用与物理系统 DPI 仍有明确差异或待验收项。[旧原生专项](../verification/memory-delete-focused-review-result.json) · [旧原图](../verification/memory-delete-visual-review-result.json) · [旧完整源码](../verification/memory-delete-full-source-review-result.json)

本轮新增未保存设置确认：依据实际设置调用链采用 420px／92vw 宽度、16px 圆角、24px 内边距、12px 间距和无普通关闭按钮的紧凑布局。模型、桌面、工作树、MCP、插件和记忆六类表单统一保护；默认继续编辑，明确放弃后执行待办离开动作。八组原生专项通过；源码专项、同一新包与安装各 34 张设置原图逐张复核，长表单独立滚动，六种主题／100%–150% 应用缩放确认操作可见。安装轮先前七张缩放差异的目测判断已更正：30 张缩放原图的边界像素与冻结源码尺寸和包内原图一致，七张再次查看，原图与旧记录保留，产品没有改动。完整源码、新包与安装各通过 373 项／74 次正常退出，每轮 597 张原图未全部视觉复核。原五个分发专项与保留数据卸载通过；物理系统 DPI、辅助技术、全部参考交互与托管发布仍需验收。[源码原图](../verification/settings-drafts-visual-review-result.json) · [包内原图](../verification/settings-drafts-unpacked-visual-review-result.json) · [安装原始判断](../verification/settings-drafts-installed-visual-review-result.json) · [测量更正](../verification/settings-drafts-installed-scale-correction-result.json) · [运行记录](../verification/settings-drafts-runtime-review-result.json)

| 表面 | 已采用 | 尚待验收或补齐 |
| --- | --- | --- |
| 主题与控件 | 明暗主题、中性灰与蓝色强调；共享按钮、输入、选择器、开关、文字提示和键盘焦点 | 每页全部状态、长表单、物理无障碍与系统 DPI |
| 对话与输入 | 展开式输入、附件、消息导航、查找、工具记录；主窗口与快速聊天共用 `/` 快捷选择 | 完整参考富文本与输入流程、最大规模内容 |
| 导航与项目 | 264px 常规／64px 紧凑侧栏；文件树、编辑器、终端和独立／并排 HTML 预览 | 完整图标对照、更多预览格式与跨平台操作 |
| 工作树 | 项目列表、会话、登记、固定、私有快照、新目录恢复、安全删除和自动清理；逐项目等待与错误 | 完整参考入口、取数方式和远程 Git 流程 |
| 设置与弹窗 | 九类与字段搜索、键盘定位、独立滚动、分类切换保留草稿、保存后回焦 | 所有异步表单状态、物理选择器与安装向导 |
| 文档与图片 | 离线 PDF 原件阅读、目录、查找、链接与只读批注；图片缩放与键盘操作 | 更多真实中文／图像样本、OCR、复杂原件版式与触屏 |
| 快速聊天与浏览器 | 独立草稿、受限桥接；临时网页标签、导航、停止和重试 | 全部参考流程、持久历史、下载与网站权限 |
| 字体与品牌 | Nook 独立图标、合法 Inter 与系统中文字体 | 与参考字体和品牌有明确差异，不能宣称逐像素一致 |

参考调用链已确认 `.command-menu-dialog` 是全局命令对话框，宽度上限 520px；现已采用这一上限、92vw 收缩、对应明暗表面和有界定位。源码专项、同一新包及实际安装均通过原六组命令行为、六组明暗应用缩放与每轮 12 张完整原生捕获；源码另含四张行为图，共 16 张原图逐张复核。[全局搜索专项](../verification/command-palette-acceptance-review-result.json) 输入区锚定快捷浮层的 420px 上限属于另一个入口。

最新分支弹窗复用原名称字段与共享控件，加入同层重命名和删除确认，避免嵌套按钮与浮层。源码专项通过 11 组行为、原六组字段布局和新增十八组明暗／三档缩放操作布局；34 张原图逐张复核。同一 `10db2c6` 编译应用体的完整开发程序、新包与实际安装各通过 371 项及 74 次正常退出；包内和安装后各 34 张分支原图也已逐张检查。每轮完整回归的 581 张原图未全部计为视觉验收，物理输入及辅助技术仍需验证；字段采用和布局检查不代表整个参考界面已恢复。[分支专项](../verification/project-branch-actions-review-result.json) · [本轮分发](../verification/project-branch-actions-runtime-review-result.json) · [包内分支原图](../verification/project-branch-actions-unpacked-visual-review-result.json) · [安装分支原图](../verification/project-branch-actions-installed-visual-review-result.json)

前轮 `c81b8c38` 新包与实际安装各通过 368 项、74 次正常退出，无强制结束；每轮保留 39 份报告和 560 张原图，236 个编译文件匹配。新包及安装后选定 70 张原图已逐张复核：两轮各 16 张搜索、26 张控件及 12 张文字提示。1,539 项单元、原五个分发专项、便携七项及卸载数据保留通过；其余原图未全部视觉复核。此前工具专项浅色 150% 捕获差异仍未唯一诊断，旧批次与原图范围保留在历史，不将重放通过写成界面修复。这些结果不替代物理系统 DPI 或全部参考流程验收。[前轮原图](../verification/command-palette-package-originals-review-result.json)

[前轮完整源码证据](../verification/command-progress-full-source-review-result.json) · [光标修复与旧包对照](../verification/composer-selection-focus-acceptance-review-result.json) · [控件对照](CONTROL-AUDIT.md) · [发布状态](RELEASE.md)

整理前的全部记录逐字保留在[设计历史](DESIGN-ALIGNMENT-HISTORY-2026-10-13.md)，SHA-256 为 `5312c3f524b04370df8a46b8031bcc8d8757ef8073ba1d017886c85cec3e17fd`；其中各旧包的通过范围、失败现场和剩余要求继续有效。
