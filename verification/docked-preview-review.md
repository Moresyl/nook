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

尚需验证并排入口转独立窗口、并排打开时移除项目、项目树联合检查及完整回归；发布门禁也需覆盖新增并排结果。当前记录不证明安装版／便携版、物理键盘与辅助技术、全部浏览器行为或 `E:/txt` 全部设计已经验收。
