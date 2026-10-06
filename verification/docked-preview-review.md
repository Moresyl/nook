# 并排预览验证记录

本记录对应 `feat/docked-preview` 基于 `b67917e` 的实现；不是已发布版本或全量 UI 对齐声明。

## 当前通过证据

- `nook-docked-preview-compact-types.log`：类型检查通过。
- `nook-docked-preview-compact-tests.log`：3 个文件、29 项测试通过，覆盖资源限制、窗口与嵌入视图生命周期、过期请求、准备／加载取消、缩放裁剪及失败清理。
- `nook-docked-preview-compact-build.log`：构建通过。
- `nook-docked-preview-native-compact.log`：9 组真实 Electron 检查通过，无运行时错误，正常退出 3062ms。SHA-256：`976e55ca06053267282f55d83240baf2e9445486cb48130f166d21770ec5fbeb`。
- 日志位于外部 `D:/GR/pi-pc/.firecrawl/`；结构化运行结果见 `project-preview-result.json`。
- 已查看八张 `project-dock-*` 浅／暗截图。主窗口捕获不包含原生子视图，因此主窗口和预览内容分别保存；没有声称获得完整原生窗口合成截图。

## 保留的失败及修正

1. `nook-docked-preview-native.log`：独立窗口刷新检查可能拿到旧窗口的就绪状态；改为等待新窗口标识与就绪状态，正常退出 4079ms。
2. `nook-docked-preview-native-ready.log`：关闭设置后预览未恢复；所有工具提示都会隐藏预览的规则改为仅处理相交工具提示，正常退出 3833ms。
3. `nook-docked-preview-native-overlay.log`：枚举正在销毁的独立窗口时读取空 webContents；检查窗口和内容是否已销毁，正常退出 5141ms。
4. `nook-docked-preview-native-owned.log`：最小窗口放大到 150% 后预览仅约 10 CSS 像素高；空间不足时改为代码／预览切换。当前通过记录为约 124 CSS 像素高，原失败正常退出 7752ms。

上述修正没有增加产品或测试超时，没有减少原有五组独立窗口检查。

## 未完成边界

后续生命周期与项目树联合检查已完成：`nook-docked-lifecycle-types.log` 类型通过，`nook-docked-lifecycle-tests.log` 为 4 个文件、73 项测试通过。`nook-docked-lifecycle-integration.log` 共 16 组（项目树 7 组、预览 9 组）通过，最终正常退出 1711ms，SHA-256 为 `5b88d72983b7695c980fb0cc6b98b93a616b7c59d90ce3c668255411c96da42b`。并排转独立窗口后核对 HTML／脚本／JSON 草稿与新会话存储，工作台草稿记录完全相同；移除项目时验证两类原生预览均被释放。发布门禁要求 9 组预览、4 组并排及两个生命周期标记，拒绝旧五组记录和缺失／不完整证据。

已合入主线 `b19492a` 的测试断言与失败清理改动，产品构建内容未因该次合并改变。完整组件与桌面回归仍需完成。当前记录不证明安装版／便携版、物理键盘与辅助技术、全部浏览器行为或 `E:/txt` 全部设计已经验收。
