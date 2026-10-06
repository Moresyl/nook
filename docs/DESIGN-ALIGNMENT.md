# Nook 设计对照

Nook 按指定的桌面资料调整布局、主题、控件与交互，**尚未达到 100% 还原**。当前参考是 `E:\txt`，版本 26.930.41038／构建 13022；旧桌面 txt 与历史总结不能替代新版证据。

设计值以 `_variables.json`、`_css-rules.json` 的选择器、主题与层叠上下文为准。`DESIGN.md`、`tokens.css` 是历史总结；静态资料不证明所有页面或功能已完成运行验收。

## 已采用的设计

| 内容 | 当前实现 | 仍需检查 |
| --- | --- | --- |
| 主题与字重 | 中性灰、蓝色强调、明暗主题；全局 medium／semibold 为 500／600 | 每个页面的局部覆盖与复杂状态；510／590 仅适用于参考的局部目录表面 |
| 首页与输入区 | 首页大输入区；对话单行胶囊，换行或附件展开，32px 发送按钮 | 完整富文本编辑器、复杂输入配置 |
| 侧栏与项目 | 默认 264px 侧栏、40px 导航行、64px 紧凑导航；项目切换、文件树、编辑器与终端 | 窄窗口采用项目适配方案；复杂工作区、完整图标对照 |
| 按钮与输入 | 默认按钮 20px 高、12px 字；明暗悬停、按下、焦点、错误与禁用状态；焦点环向外偏移 | 更多控件组合、边缘裁切、最大规模表单 |
| 选择器 | 默认 22px 高、6px 圆角；收起省略长名称，展开显示全文；悬停与键盘高亮 | 复杂菜单与输入组合 |
| 开关与复选框 | 32×19px 开关、13px 拇指；18px 复选框、14/20px 标签、8px 间距 | 部分禁用／半选为临时状态探针；系统辅助技术验收 |
| 设置与弹窗 | 设置上限 720×460；视口余量 32px／40px；按可用高度差的 1/18 上移，小于 768px 铺满 | 短内容弹窗按自身高度定位；更多复杂内容与长表单 |
| 按钮提示 | 14px 字、8×12px 内边距、8px 圆角；悬停／键盘焦点、弹窗作用域、边缘避让 | 非按钮原生 title 与专用预览尚未全部迁移 |
| 启动与恢复 | 56px 独立标志、180ms 淡入、60ms 延迟、扫光与减少动效；持续错误、键盘重试、草稿恢复 | 主窗口创建前的等待、真实损坏数据与平台启动故障 |
| 图片阅读 | 大图适应、小图不放大、同组切换、40px 圆形导航／关闭、36px 缩放；键盘、拖动、滚轮、双击、重试 | 触屏双指、旋转与更多真实图片 |
| PDF 与 HTML | 离线 PDF 版式、目录、查找、链接与只读批注；HTML 浮动／并排预览和小窗口切换 | 完整参考预览流程、更多格式、复杂中文／图像样本；HTML 面板尺寸与切换阈值是项目实现选择 |
| 字体与品牌 | Inter、系统中文字体、Nook 名称与独立图标 | 未分发 OpenAI Sans；品牌与字体差异明确保留，不能声称逐像素一致 |

控件的具体色值、状态与测量证据见[共享控件对照](CONTROL-AUDIT.md)。功能范围见[能力与边界](CAPABILITIES.md)。

## 当前验证

`77fe114` 候选包含 PDF 阅读、图片查看器、按钮焦点、复选框和代码换行等调整。完整未安装应用体 235 组通过；同一包设置重跑四组通过，包含八个设置分类、七组窗口／缩放组合、768px 边界、焦点与草稿保留。首轮设置退出超过原有 10 秒期限，失败原因尚未证实；重跑通过不代表原因已消除。

源码、未安装包、实际安装版和便携版分别验收。当前包体哈希、各轮结果和真实安装进度统一见[发布状态](RELEASE.md)与[候选记录](../verification/originals-package-result.json)，历史数字与截图不能替代新包证据。

## 界面截图

| 场景 | 已检查截图 |
| --- | --- |
| 当前候选 PDF | [浅色阅读](images/candidate-pdf-original-light.png)、[深色最小窗口](images/candidate-pdf-original-dark-minimum.png)、[目录](images/candidate-pdf-outline-light.png)、[查找](images/candidate-pdf-search-light.png)、[批注](images/candidate-pdf-note-light.png) |
| 字重与焦点 | [浅色字重](images/current-typography-light.png)、[深色字重](images/current-typography-dark.png)、[浅色焦点](images/button-focus-light.png)、[深色焦点](images/button-focus-dark.png) |
| 复选框 | [浅色](images/checkbox-light.png)、[深色](images/checkbox-dark.png)、[深色窄窗 150%](images/checkbox-dark-narrow.png) |
| 启动与错误 | [浅色占位](images/startup-light.png)、[深色占位](images/startup-dark.png)、[读取错误](images/startup-error.png)、[窄窗错误](images/startup-error-narrow.png) |
| 提示与菜单 | [浅色提示](images/tooltip-light.png)、[深色提示](images/tooltip-dark.png)、[长标题](images/tooltip-long-title.png)、[浅色菜单](images/select-highlight-light.png)、[深色菜单](images/select-highlight-dark.png) |

PDF 五张截图来自当前候选的真实未安装应用体，其字节也与此前源码截图一致。其余图片属于对应历史源码／分发批次，只用于查看已检查的设计状态；不能冒充当前安装版截图。图片、PDF 和 HTML 的详细交互与验证边界见[附件](ATTACHMENTS.md)、[PDF 阅读](PDF-PREVIEW.md)和[HTML 预览](PROJECT-PREVIEW.md)。

## 完整验收仍需完成

- 核对完整页面、控件状态和交互清单，包括独立 Quick Chat、浏览器、分离窗口及其他扩展页面。
- 在最终构建中检查正常、空白、加载、错误、禁用、长内容与最大规模，并覆盖明暗、缩放、键盘和减少动效。
- 完成原生系统向导／选择器、物理输入与辅助技术验收；当前原生 Computer Use 不可用，静默安装与测试替身不替代这些证据。
- 将截图与运行记录关联到同一应用体，再完成全面、多轮测试和流水线发布。完整要求见[交付记录](DELIVERY.md)。

全部历史批次、失败现场、修正过程与旧截图链接保留于[本次整理前的设计记录](DESIGN-ALIGNMENT-HISTORY-2026-10-06.md)及[更早的设计历史](DESIGN-ALIGNMENT-HISTORY-2026-10-05.md)。整理没有取消其中的未完成要求。
