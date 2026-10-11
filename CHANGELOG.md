# 更新记录

## 未发布

### 新功能

- 默认管理目录及共享下拉控件修复后的全量单元 115 个文件／1,202 项通过，语句 97.31%、分支 95.08%、函数 97.44%、行 99.42%，保留原有 80% 覆盖门槛；React 界面通过独立桌面专项验证，不计入这些覆盖率。

- 工作树根目录留空时使用当前资料目录下的默认位置，设置显示默认路径，创建表单建议可修改的子目录。读取路径不写盘；实际创建通过 Git 检查后才准备默认目录，拒绝文件与目录联接冲突，失败保留源仓库、输入与配置，重试可创建。空配置随备份恢复及重启保留；备份不复制 Git 文件。新增 20 项文件系统单元与 3 项真实 Git 集成测试，相关 165 项、类型和构建通过；桌面专项十组、三次正常退出通过，20 张原图逐张复核。修复共享下拉框内部按钮未同步禁用属性的问题。当前完整回归与分发验收继续进行。

- 工作树根目录新增系统文件夹选择按钮。选择只更新输入，取消或失败保留原输入与数据，显式保存后生效；操作期间锁定设置和关闭。修复共享弹窗忙碌时连续按 Escape 仍可能被原生关闭的问题。117 项相关测试和七组真实桌面专项通过，14 张原图逐张核验；后续完整单元 1,179 项、完整源码 303 项／43 次正常退出通过，本轮 50 张选定原图逐张检查。系统对话框返回值在真实主窗口 IPC 中隔离验证，物理系统窗口和当前分发验收仍待完成。

- 新增「设置 → 工作树」默认根目录：保存已有目录的绝对路径，创建表单建议新的可编辑子目录，留空仍可手动填写。设置随备份、恢复和重启保留，不移动已有工作树、不自动删除文件。保存失败保留配置和输入，显示中文错误；忙碌时锁定九个分类与关闭操作。输入宽度上限 288px、标题间距 8px、说明字号 12px；六组真实桌面专项和 11 张原图核验通过，完整新版分发验收继续进行。

- 新增独立 Git 工作树创建、列表与项目登记：选择新分支及起始版本，或使用未占用的已有分支；创建保留原项目分支、暂存区、文件改动、编辑草稿与预览。目标文件夹已存在时拒绝操作，不强制重置分支；钩子报错后读取实际结果，部分文件保留。项目登记失败可单独重试，不重复创建。服务及已有 Git 回归 25 项、桌面专项 7 组通过，12 张原图逐张检查；完整新版分发验收继续进行。

- 新增会话上下文摘要：选择模型与保留轮数，生成只读预览、编辑并应用、选择历史摘要或恢复完整上下文。完整消息、附件和工具记录继续保存；原文变化后旧摘要失效，后续请求恢复完整历史。普通发送、重试、编辑分支、模型比较与受限快速聊天共用已验证的请求上下文。支持取消、失败保留和实际服务用量；暂不自动触发或分段生成。新增能力的最终安装包和流水线验收仍在继续。

- 工具记录改为操作／路径／查询摘要与真实状态、耗时。运行中默认展开，结束后默认收起；两种展开选择独立保存，流式更新不覆盖手动选择。输入与结果保持完整原文，可分别复制、失败重试；旧复制请求不会把新输出标成已复制。自动收起先将详情内的键盘焦点移回摘要，隐藏详情不再接收焦点。主工作台与快速聊天共用，支持减少动效。恢复自家主文档的剪贴板写入，读取、子框架和非自家窗口仍拒绝。39 项专项单元测试覆盖率 100%，8 组真实桌面专项通过；9 张原图逐张检查，整套参考界面与最终分发验收仍待完成。

- 项目 Git 面板新增本地分支查找、创建和切换，支持中文名称、Enter 提交、当前／工作树占用标记及错误重试。常规切换保护拒绝覆盖改动与未解决冲突；切换前保存编辑草稿，随后刷新文件树和干净文件，保留未保存内容及原始比较基线。关闭该项目预览；Git 钩子在 HEAD 已切换后报错时显示真实分支与中文提示。八组真实桌面专项、219 个分支与两主题三档缩放通过；十三张原图逐张检查，修复了工具栏样式侵入弹窗造成的文字溢出。本地分支功能不包含远程 Git、工作树删除／修剪、分支删除或重命名。

- 新增侧栏浏览器：在独立临时网页会话中打开 HTTP(S) 地址，支持原生返回／前进、刷新、停止、错误重试和 `Ctrl L`／`F6` 地址栏焦点。切换页面保留网页与聊天草稿；退出后不恢复网站存储。网页不开放工作台桥接或 Node，弹窗、私有协议和网站权限请求受限；下载与授权可使用系统浏览器。支持最多 16 个独立标签及共享临时网站存储，后台失败与关闭仅影响所属页；原生 Ctrl T／W／Tab 快捷键和标签键盘切换可用。关闭最后一页会清理会话并新建空白页；主工作台重载释放全部标签。保存标签／历史、内置下载、浏览器自动化与同包验收尚未完成。

- 新增独立快速聊天窗口，可选择模型、项目与扩展，查看流式回复和 PDF，保存独立的新聊天／会话输入，在主工作台继续同一会话。窗口支持置顶、收起、隐藏和可选全局快捷键目标；停止与审批仅作用于当前快速聊天。受限桥接不开放主工作台的任意文件或终端操作，原件随完整备份保存，恢复后拒绝旧草稿版本的发送。完整桌面、同一包体分发与托管验收待完成。

- MCP 资源与提示词的 PDF 可直接阅读原始页面、查找和导出，并显式作为附件加入当前聊天。保留已有草稿与模型选择，保存失败可以重试，原件随备份与重启恢复；模型仍只接收提取文本。订阅更新忽略旧预览结果，关闭异步文件预览后恢复入口焦点。新功能的同一应用体分发与托管验收待完成。

- PDF 导入保留原件，支持离线版式阅读、文本选择、目录定位、全文查找、页内／外部链接和只读批注；聊天附件、资料库与引用可查看并导出原始字节。完整工作台备份去重保存 PDF 原件，恢复时可重建缺失文件；八种模型协议仍只发送提取文本，不发送原件。原件存储、阅读与真实请求专项通过，同一包体分发验收待完成。

- 项目编辑器新增 HTML 预览：运行当前未保存的 HTML，读取项目内 CSS、JavaScript、JSON、图片和字体；独立临时会话隔离工作台权限，重新预览替换旧窗口，空草稿保持空白。实际桌面 5 组专项通过，安装版验收待完成。

- 新增由用户显式管理的记忆：可搜索、编辑、停用、删除，并选择全局或项目范围。启用条目随对应范围的模型请求发送，临时聊天不读取；记忆随完整工作台备份保存，移除项目同时移除其记忆。组件测试及实际桌面专项通过，分发验收尚未完成。

### 修复与打磨

- 模型比较在保存失败时完整显示中文提示，自动定位错误且保留原问题、选择和数据，支持直接重试。准备期间头部、底部关闭与 Esc 均阻止关闭。错误滚动留白修复窄窗口缩放边界；新结果从第一条回复开始显示，同组流式更新保留手动滚动。全量单元 1,135 项及完整桌面 296 项／42 次正常退出通过；专项与完整回归各 17 张比较原图逐张核验，覆盖明暗窄窗口的三档缩放。新分发继续验收。

- 恢复备份期间禁用设置弹窗关闭、Esc 与页面导航，等待完整恢复通知和界面更新后再允许操作。延迟真实恢复通知的旧应用体复现失败；修复后的真实桌面专项 8 项、发布策略 65 项及全量 1,135 项单元测试通过。完整源码、未安装版与实际安装版各 296 项、42 次正常退出通过，无运行时错误；三轮 57 张原图逐张核验。同包启动器、便携、实际安装／保留数据的卸载及十一份运行记录通过。旧安装候选超时原因仍未完全确认，模型比较提示的视口可见性及全部参考界面仍在改进。

- 此前工具记录候选的未安装版与实际安装版分别完成 283 组完整检查、40 次正常退出；便携 7 组、安装／卸载及十一份同包记录通过。27 张工具原图和另外 10 张界面原图已逐张检查。首次安装版的快捷聊天部分回复可见性超时保留，原因未确认。旧工作区重放的测试夹具改用唯一草稿标记并明确新建空白快捷会话，避免误接收上轮输入和回复；约 84 MB 原工作区与全新工作区各 9 组重跑通过，全部断言和原有期限保留。

- 并排 HTML 预览在主界面重载或渲染进程崩溃时释放旧视图，并取消尚未完成的准备；重新打开使用新会话，保留编辑草稿，旧关闭请求不能影响替代视图。
- 页面切换、窗口调整和缩放时，侧栏保持当前选中项可见；页面导航增加当前页面标记。保留手动滚动与紧凑图标布局。

- 主工作台、快速聊天与 PDF 原件导出使用中文保存错误提示，自动任务的无效 Cron／时区提示也使用中文。已知错误提供具体恢复操作，未知服务错误保留原始诊断文字。实际保存失败保留输入、原件和既有目标文件，恢复后可重试；源码、未安装版与实际安装版三轮完整回归，以及匹配安装／便携证据均通过。全部参考界面与托管发布仍待验收。

- 工作台快照、事务返回值和备份改为逐条记录复制，避免把全部会话交给一次 `structuredClone` 临时序列化。副本仍与已保存状态隔离，保留完整字段、Unicode、记录顺序和失败后的重试行为；真实桌面及分发验收待完成。

- 显式退出应用时，已崩溃的主界面不再等待无法完成的草稿响应，继续执行服务清理和已保存工作台合并。实际崩溃退出两组专项通过，保存的中文／emoji 草稿与会话完整保留；未保存输入、自发崩溃和间歇原生退出超时仍未解决，完整回归及分发验收待完成。

- 修正终端清理尚未结束时，重复关闭、关闭项目或退出工作台可能提前返回的竞态；这些操作等待同一清理结果，结束前保留终端数量名额。四项回归在旧实现失败，修正后相关 24 项测试及新工作台／大型现场各六组实际终端专项通过。此前原生退出超时和整轮异常退出仍保留，尚未确定根因。

- 修正快速聊天在 420×360、125%／150% 缩放下隐藏工具或模型选择的问题；长输入、附件与说明限高滚动，工具栏支持焦点跟随。修正快速输入期间丢弃主题刷新及旧快照覆盖新配置的竞态，保留独立草稿。短窗保存错误可用键盘完整阅读，关闭按钮保持可见。18 组状态／主题／缩放与九组实际桌面专项通过，完整回归及分发验收仍待完成。

- 自动任务的启动恢复、计划检查和执行前查询仅复制任务记录，避免额外复制聊天历史。真实桌面任务专项十组通过，20 次系统恢复检查没有复制整份工作台；原有落盘、取消、重启和备份恢复路径保留。

- 桌面验证先在原有 5 秒操作期限内等待 Electron 原生导出就绪，再检查必需的启动配置，修正重启时过早读取 `app.commandLine` 的测试错误。没有延长启动或退出期限；此前启动超时和未完成诊断记录保留。

- 引用回复和提示模板插入后，在对应草稿的 React 布局提交阶段聚焦，避免延迟光标定位干扰随后的替换与选择；弹窗的打开、关闭和焦点恢复同步到同一布局阶段。最终源码的模板、助手绑定、共享控件、引用草稿和十二处信息提示共 29 组实际桌面专项通过；类型、构建及完整串行 920 项测试通过。OAuth 登录／刷新／失效及提供商并发编辑／移除分成独立真实用例，全部操作仍在各自原定 5 秒门槛内，原有断言与已保存凭据路径保留；此前默认并发 13 项失败、串行 2 项超时及中间弹窗回归均继续保留。

- Windows 构建失败时在原生退出阶段保留失败返回码，防止较早注册的依赖退出回调把错误改成成功。真实子进程回归修复前失败、修复后两项通过；类型检查和完整 915 项测试通过，原有覆盖率门槛保持不变。

- 统一项目名称／路径、文件树、Git 分支、模型容量与 PDF 链接／批注的信息提示，采用新版 300px 上限。键盘提示在滚动时重新定位，Escape 先关闭提示再关闭所属弹窗；保留文件树单一 Tab 焦点、PDF 覆盖区域与链接动作。提示七组、共享控件四组、PDF 六组、文件树七组，以及完整 913 项组件测试通过；十二张原生全窗口截图已检查。默认完整桌面 235 组亦通过，未启用额外 MCP 启动预载；历史失败保留，原因未确认。此前生成的安装候选在分发回归中发现引用后替换草稿失败；修正后的重新生成与完整分发验收仍待完成，不能据此认定完整设计或发布验收完成。

- 自动恢复副本改为完整 gzip JSON，保留同步落盘、原子替换和原字节恢复；旧版纯 JSON 副本保留。相同大型工作台的隔离事务与模型比较回放通过，减少该样本的恢复副本写入耗时；完整串行及默认并发两轮各 886 项组件测试通过，性能不代表所有数据与存储设备。

- 代码块新增可用键盘切换的自动换行，保留原文、缩进及复制内容；图表源码同样支持，窄窗长语言名称不挤出操作按钮。类型、构建、13 项相关测试及两轮实际桌面内容专项通过，分发验证待完成。

- 统一自动任务资料集复选框的明暗主题、焦点与状态样式，长名称可换行。类型、构建及自动任务十组专项通过，包含真实选择保存、重新编辑与 150% 缩放；尚未进入安装候选。

- MCP 连接、资源与 OAuth 配置读取改为只复制服务器配置，保留实时配置校验。800 项组件测试通过；完整工作台的订阅专项六组通过，24 次真实 IPC 读取没有复制完整历史。最新完整回归与分发验收待完成。

- 修正多项目横向列表在窄窗口与缩放后隐藏当前项目的问题，固定新增入口，保留手动滚动、键盘焦点与编辑草稿；源码项目专项通过，安装候选待更新。

- 草稿保存与会话选择使用范围受限的事务，避免复制和重新校验完整聊天历史；保留原子写入、完整上一版备份和重启恢复。778 项组件测试、类型与构建通过；大工作台服务层对照没有测出整体提速，实际桌面备份超时仍未证明解决。

- 将三项纯 JavaScript 启动依赖纳入主进程构建，减少启动期间逐个读取依赖文件的开销；原生模块保留现有加载方式。设置与记忆专项均可完成启动并正常退出，尚不能证明所有环境的启动问题已消除。

## [0.1.0-alpha.1] - 2026-10-11

Nook 的首次独立预发布版本。独立仓库没有上一版本，不沿用其他项目的版本历史。

### 新功能

- 项目可创建独立 Git 工作树，选择新分支及起始本地分支，或使用未被占用的已有分支。创建固定起始提交，保留原项目分支、暂存区、文件改动、编辑草稿与预览；完成后显式登记并打开另一个项目。登记失败保留创建结果和名称，重试不会重复创建；已有登记可直接打开。钩子报错或改变分支时显示实际状态，未完成的文件保留。工作树删除／修剪、管理根目录和自动任务编排仍待实现。

- 会话上下文可生成、编辑和选择历史摘要，也可恢复完整上下文。生成预览不会改写聊天；应用后只在请求中使用摘要与近期消息，完整原文、附件和工具记录继续保存。原文变化使旧摘要失效，发送时恢复完整历史。支持取消、失败保留、实际用量和重启恢复，主工作台与受限快速聊天共用已验证的上下文；普通发送、重试、编辑分支及模型比较也采用对应上下文。每次摘要原文请求限 4 MB，暂不自动触发或分段生成。

- 工具记录显示操作／路径／查询摘要、真实状态与耗时。运行和结束阶段分别保存展开选择，流式更新尊重手动收起；完整输入与结果可分别复制，保留 JSON 大整数、重复键和文字 HTML，失败可重试。自动收起时先返回摘要焦点，隐藏详情不能继续接收键盘输入。主工作台与快速聊天共用，并支持减少动效；自家主文档可写入剪贴板，读取、子框架和非自家窗口维持拒绝。展开动画保持原文面板的自然高度，不再压缩输入和结果。

- 项目 Git 面板支持查找、创建和切换本地分支，保留中文名称、未保存草稿与原始比较基线，刷新文件树和干净文件并关闭该项目预览。覆盖改动、重复名称、工作树占用和未解决冲突会阻止操作；钩子在切换完成后报错时显示实际分支和受控提示。操作期间暂停取消与重复提交，失败后保留输入供重试。远程 Git、工作树删除／修剪、分支删除／重命名仍待实现。

- 临时浏览器支持最多 16 个网页标签，各自保留原生历史、未提交网址与加载错误，同站点共享临时网站存储。提供返回／前进、停止／重试、Ctrl L／F6、Ctrl T／W／Tab／Shift Tab 和标签方向键／Home／End／Delete 操作；切回聊天保留草稿。关闭最后一页创建新的空白会话，主工作台重载释放全部标签，退出不恢复网站存储。网页不能访问工作台桥接或 Node；保存标签／历史、内置下载、权限授权和自动化仍待实现。
- 提供本地聊天、流式回复、停止与重新生成，以及 OpenAI Responses／兼容接口、Anthropic、Gemini、Azure 和 Ollama 连接。模型配置、输出预算及实际请求用量可查看和保存。
- 消息可引用、在新分支重发或仅保存修改。旧回复和完整原文保留；回复版本及分支导航支持预览、搜索和完整分页，各条路径独立保存后续消息、草稿与附件。
- 临时聊天只在本次应用运行期间保留，消息、附件、草稿、分支及回复版本不进入本机聊天历史或完整工作台备份；退出后清除，普通聊天草稿保持独立。
- 对话分支可调整同层顺序或恢复时间顺序，完整子路径一起移动。排序跨分页保留选择，随普通历史、完整备份和重启保存；临时路径的排序仍只保留在内存。
- 同一问题可并行比较 2–4 个已配置模型，保留相同完整上下文、附件和助手／项目说明。回复可分别停止、失败或继续，当前草稿保留，普通组随历史与完整备份保存，临时组随应用退出清除。
- MCP 资源可显式订阅更新，自动刷新所选资源的只读预览，并手动加入草稿。支持中文资源模板、逐项取消和连接能力提示；断开或重启后停止订阅，已有草稿保留。
- MCP 资源和提示词中的二进制文件可显式导出原始字节；常见图片可通过受限工作线程预览规范化副本，SVG 和音频仅导出。空文件、取消与失败重试保持独立，手动用于对话只加入文本。
- 提供 PDF／Office／OpenDocument 文本提取、图片输入及预览，资料集、关键词与语义／混合检索，以及回复来源片段。聊天内容支持公式、代码高亮和 Mermaid 图表。
- 项目工作台包含可展开文件树、本地代码编辑器、未保存草稿、Git 审阅／暂存／提交及真实终端。分析和执行模式展示工具过程，文件修改和命令分别确认。
- 提供助手配置导入导出、变量提示模板、自动任务、MCP 工具／资源／提示及 OAuth、本地技能、隔离插件、统一命令搜索、聊天正文查找、系统托盘和全局唤起快捷键。
- 完整工作台可导出 JSON 或 gzip 备份，保留对话、附件、资料库、草稿及本地扩展资产；恢复后的插件需要重新授予权限。

### 变更与安全

- 应用显示名称、独立图标和 Windows 产品元数据统一为 Nook，已有 Qiyao 数据目录继续兼容读取。主工作台与隔离插件使用 OFL Inter 字体；参考设计的采用范围与差异见设计对照文档。
- 配置的密钥在本地加密，并绑定连接目标；共享备份不包含密钥。插件按声明的能力与项目范围授权，文件、命令及远程工具调用保留具体操作预览。
- 清理产品及项目法律说明中的旧项目标识，完整保留原始开源许可证、401 份依赖法律文档及安装器组件来源。流水线检查编译后的旧身份／已移除字体引用、包内法律说明与源码的一致性、原始文件字节和同一应用体的运行记录，发布文件附对应源码与 SHA-256。
- MCP 二进制输入限制单项 2 MB、单次 12 项／合计 12 MB，验证规范编码和文件元数据。模型读取结果只含文本与文件元数据，图片预览和导出操作不会自动调用模型。

### 修复与完善

- 恢复备份期间禁用设置弹窗关闭、Esc 与页面导航，等待完整恢复通知和界面更新。真实桌面 8 项、发布策略 65 项及全量 1,135 项单元测试通过，7 张原图逐张检查；新应用体的完整桌面与分发验收继续进行。上一工作树安装候选的恢复后发送与退出超时仍保留，未宣称原因已查明。

- 此前摘要候选的未安装版与实际安装版各通过 289 项完整检查、41 次正常退出；便携 7 项、共享控件 4 项、文字提示 7 项、崩溃退出 2 项及十一份匹配记录通过。安装／卸载、包体一致和用户数据保留均已检查，18 张完整分发轮次摘要原图逐张核验。此前安装版部分回复可见性超时的原因尚未确认，原始失败与哨兵文件继续保留。

- 新版安装验收同步 296 项门槛，要求 7 项工作树及 6 项摘要证据，检查创建保留、登记失败重试、钩子、受限快速聊天、实际请求和重启。完整运行前清除两类专项开关；保留 HTML 预览、项目分支、工具记录、包体一致性与卸载要求。本次工作树应用体的完整分发验收仍在进行，上方摘要候选的记录仅适用于此前应用体。

- 文件标签在窗口调整和缩放后自动显露，支持左右方向键循环、Home／End 及 Delete 关闭；未保存文件保留确认，取消或关闭后恢复焦点。窄编辑器的预览与保存采用 24px 图标操作，仍可查看中文名称和提示。
- 项目文件保存遇到磁盘或权限错误时显示可恢复的中文提示，保留草稿、标签和原文件；原始系统诊断留在错误原因中，不直接展示到界面，恢复后可重试保存并关闭。文件冲突与范围校验保留原有行为。

- 并排 HTML 预览在主界面重载或渲染进程崩溃时释放旧视图，取消尚未完成的准备；重新打开保留编辑草稿并使用新会话，拒绝旧视图的关闭请求。
- 侧栏在页面切换、窗口调整和缩放后保持当前选中项可见，页面导航增加当前页面标记。短窗口继续使用紧凑图标与手动滚动。

- 会话切换与待写草稿合并为一次原子保存，减少重复备份写入；连续排队选择保留最后一次，普通／临时聊天和刷写顺序仍隔离，失败保留待写草稿以便重试。

- 脚本加载前显示居中的 Nook 启动标志，支持系统明暗、淡入扫光及减少动效。首次工作台读取失败时保留明确提示和重新加载入口，避免错误自动消失后停留在加载状态。

- 共享按钮与图标按钮增加明暗工具提示，支持键盘焦点、弹窗内显示、边缘避让与单提示互斥；禁用按钮保留说明，长标题安全换行，点击或键盘激活后关闭。

- 开关开启色采用参考桌面应用层配色，禁用开启轨道使用对应半透明状态。
- 弹窗按可用视口计算边距与上移位置，在短宽窗口和缩放下保留内容空间；选择器区分选中与悬停／键盘高亮。
- 默认按钮采用 20px 高度与紧凑间距，补齐明暗按下状态；修正选择器触发器及弹出列表内边距。
- 草稿保存和会话激活省去未使用的完整工作区返回副本，保留持久化顺序、事务隔离与失败回滚；同一大工作区的备份、恢复和重启复测通过。
- 统一共享控件的明暗键盘焦点色和输入悬停／聚焦边框；非法输入保持错误状态，修正后恢复正常样式。
- 开关关闭、悬停与禁用状态分别采用参考的明暗配色，长标签旁的轨道保持原尺寸。
- 修复分支保存错误提示因滚动取整被裁切的问题，并让工具失败状态使用主题对应的错误色。
- 工作区启动改为完整字节读取后统一解码；诊断分别记录文件读取、文本解码和 JSON 解析边界，不记录工作区内容。
- 通用弹窗与设置统一采用 720×460 上限，窄屏铺满，长内容独立滚动，页脚操作保持可见。
- 修复禁用命令悬停时变亮的问题，统一禁用按钮／开关的视觉反馈和按钮键盘焦点环。
- 修复超长连接和模型名称撑高输入区的问题：收起的选择器显示单行省略文本和下拉箭头，菜单保留完整名称与自动换行。
- 对话输入框在单行且无附件时使用胶囊布局；换行或添加附件后自动展开，恢复单行后收回。工具栏放在输入框下方，发送按钮位于输入区右侧，首页保留大输入区。
- 输入框在窗口宽度变化后重新计算自动换行高度，保留草稿和焦点；长文本保持高度上限和内部滚动，替换为短文本后收回。
- 首页和项目说明精简为任务入口与使用指南；设置采用 720×460 布局，分类和详情独立滚动，原生下拉菜单统一明暗样式与键盘操作。
- 项目切换移至顶部，为编辑器释放宽度；窄输入区使用带提示和数量的图标操作。极窄视口采用紧凑导航，修复聊天列表被底部操作区遮挡的问题。

- 便携启动器对解压目录的短暂文件占用进行有界清理重试，成功时保留应用退出码；持续占用会明确返回失败，启动前清理失败时不继续覆盖解压。
- 项目文件和终端查询只读取当前项目的独立副本，避免大型工作台中每次查询复制全部聊天历史；未提交的更新和失败的修改不影响当前已保存项目，删除后立即拒绝后续访问。
- 多模型比较共享启动准备，在一次原子更新中保存整组初始消息并统一通知界面；组保存失败时保留完整工作台与其他进行中的回复，重试可完整创建各路对话。
- 同一轮到达的多路回复检查点合并为一次原子工作台更新，分别保留回复原文、完成状态和完整上一份文件；保存失败时整批拒绝并可重试，删除后的对话与消息不会被重新创建。
- 流式回复、草稿及已有对话的续聊启动使用绑定主文件版本的恢复日志，保留独立的上一版完整备份；正常关闭时写回原有 JSON 格式。日志损坏或归属错误时保留文件并报告恢复错误，主文件被替换或变成目录时不再确认不可恢复的日志保存。
- 草稿和对话元数据保存复用未修改历史的编码比较，避免重复序列化大段消息，同时保留 JSON 属性顺序及原有完整备份。
- 快速切换对话时合并尚未开始的选择保存，最新选择落盘后才返回成功；普通与临时对话分别排队，重启仍恢复此前最后一个普通对话，临时内容保持不落盘。
- 关闭项目差异预览时先释放差异视图，再释放文本模型，取消仍在进行的计算，避免延迟工作线程结果触发运行时错误。
- 项目终端优先使用标准目录中已安装的 PowerShell 7，缺失时保留原有 Shell；异步发现后重新检查关闭状态和会话上限，避免退出期间或并发打开时创建多余终端。
- 比较卡片从原始回复的请求记录读取连接与模型。沿所选路径换模型续聊后，原回复的标注及备份恢复保持一致，缺少原始请求记录时明确显示未记录。
- 分支切换等待当前草稿保存，保存失败保留输入与选择并允许重试；原对话删除后保留其他路径，原有直接导航按钮继续可用。历史数据含重复对话标识时显示可恢复的错误，保留原始文件与草稿，恢复有效备份后可继续浏览。
- 分支排序保存失败后可保留原状态重试；并发发送或重试保留后台最新顺序，旧聊天对象不能覆盖新排序。新增分支与原文档案不继承父路径在另一层的序号。
- 并行启动时已保存的流式检查点会逐条通知界面，恢复被早期状态更新盖掉的部分文本；新增比较入口后仍保留原有发送按钮尺寸。
- 延迟返回的启动通知采用最新已保存状态，避免旧全量快照再次覆盖其他模型已经保存的部分回复。
- 持续资源更新按顺序读取并及时显示每次完成的结果，避免通知密集时预览一直为空；刷新期间仍可手动使用已显示内容，不会自动发送模型请求。
- 图片预览按 Escape 只关闭最上层弹窗，保留底层设置；切换 MCP 资源或分类后，延迟读取与图片结果不会替换当前预览。
- 修正隔离插件面板对已移除字体的引用和文件匹配，实际加载与主工作台一致的 Inter 可变字重。
- 项目目录采用完整分页，避免旧清单截断；短窗口在 100%／125%／150% 缩放下保留聊天操作、可见标题以及代码／终端的使用空间。
- Windows 便携启动器使用完整原生文件提取和扩展路径，保留长路径文档，并在正常退出后清理临时提取目录。安装版卸载保留用户数据。

### 安装

- Windows x64 安装版：`Nook-Setup-0.1.0-alpha.1-x64.exe`；便携版：`Nook-Portable-0.1.0-alpha.1-x64.exe`。安装版支持当前用户及自选目录；便携版无需安装。
- 使用随版本提供的 `SHA256SUMS.txt` 核对文件；对应源码、实际验证记录与更新说明一并提供。启动后自行配置模型连接；已有工作台可先导出完整备份。
- 此版本为预发布，Windows 可执行文件未签名。其他平台、原生语音／OCR、媒体生成、远程同步及离线模型下载管理尚未提供。

### English

Adds independent Git worktree creation, listing and explicit project registration from a new or available local branch. Pins the selected base commit and preserves the source branch, index, edits, editor drafts and previews. Refuses existing destinations and force resets, reports actual hook outcomes, retains partial files and retries failed project registration without recreating the worktree. The service/Git regressions pass 25 tests and the native feature suite passes seven groups with twelve reviewed originals; complete verification of the updated distribution is still pending. Worktree removal/pruning, managed roots and task orchestration remain outside this batch.

The earlier context-summary candidate passes 289 checks and 41 normal exits in each unpacked and installed run, seven portable checks and eleven matching runtime records. Eighteen complete-run context-summary originals were individually reviewed. The later worktree candidate passes 296 checks and 42 normal exits in source and unpacked runs but fails installed acceptance after 234 checks, with a send timeout and one forced exit. Those failures remain recorded with unconfirmed causes.

Keeps settings open and disables Escape and navigation until backup restoration finishes. A delayed real restore acknowledgement reproduces the missing guard in the old body. The fix passes eight native checks, 65 release-policy tests and 1,135 full unit tests, with seven individually reviewed originals. New complete runtime and distribution verification remain required.

Adds editable, versioned conversation summaries without removing original messages or attachments. Preview, cancellation, provider failure, stale-source fallback and restart retention are verified. Main and restricted quick chat share the validated request context; sending, retry, edited branches and comparison use the selected context. Summary generation uses no project tools or extensions, has a 4 MB source-request limit, and is currently manual rather than automatic or chunked.

Installation verification now requires the 296-check baseline, seven worktree checks, six context-summary checks and complete backup-restore acknowledgement, alongside preview reload, project branches and tool activity evidence. It clears both focused-suite switch families and retains package matching and data-preserving uninstall checks.

Tool records show contextual summaries, explicit execution status and elapsed time, with separate running/completed disclosure choices and exact original input/output copy payloads. Streaming updates preserve manual collapse; stale or rejected clipboard requests support safe retry. Automatic collapse returns keyboard focus before making details inert, and opening animations preserve natural text-panel heights. Main and restricted quick chat share the component and reduced-motion behavior. Clipboard writes are permitted only for owned top-level application documents; reads, child frames and unowned windows remain denied. Full reference UI and final distribution acceptance remain pending.

Adds local project branch search, creation and switching with Unicode names, occupied-worktree markers and normal Git overwrite protection. Refreshes clean editor files and the tree while retaining unsaved drafts and their original comparison baseline; closes project previews after switching. A failing post-checkout hook reports the actual changed branch without raw diagnostics. Remote Git, worktree removal/pruning and branch deletion/renaming remain pending.

File tabs reveal the selected file after resizing or zooming and support arrow keys, Home/End and safe Delete-to-close. Compact editor actions use 24px icons with accessible names. Filesystem save failures retain drafts and original bytes, show a recovery message without raw diagnostics and permit save-and-close retry.

Releases docked HTML previews and cancels pending preparation when the workbench reloads or crashes. Reopening retains editor drafts and rejects stale close requests. Sidebar navigation keeps the selected item visible after page changes, resizing and zoom, with a current-page marker.

Adds a private multi-tab browser with independent history and address drafts, shared transient site storage, background failure recovery and native create/close/cycle shortcuts. Closing the final tab creates a fresh session; workbench reload releases every view. Websites receive no application bridge or Node access. Saved tabs/history, downloads, permission grants and browser automation remain pending.

First independent prerelease of Nook, a local AI workspace for Windows. Includes multi-provider streaming chat, reply versions and branches, two-to-four-model comparison, temporary chats, document/image input, knowledge retrieval, project editing, Git and native terminals. Assistants, prompt templates, scheduled tasks, MCP tools/resources/OAuth and isolated local extensions use the existing workspace and approval flows. Complete JSON/gzip backups omit credentials.

The interface now uses the Nook identity, themed native controls, a 720×460 settings layout, a wider project workspace and a single-line composer that expands for wrapping text or attachments. Long selected model names stay on one line while menus show their full labels. Draft persistence, branch switching, parallel stream restoration and portable cleanup include the verified fixes detailed above. Reference-design differences remain documented.

Windows x64 installer and portable binaries are unsigned. Matching source, original open-source notices, verification records and SHA-256 checksums accompany the release. Native voice/OCR, image generation, remote synchronization and other platforms are not included.
