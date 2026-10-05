# 开源许可与资源来源

Nook 采用 **LGPL-3.0-or-later**。原始 [LICENSE](../LICENSE)、配套 [COPYING](../COPYING) 和[项目来源声明](../licenses/project/NOTICE.txt) 保留原文与原始字节；产品改名不改写作者、版权或许可证内容。

## 查看许可

| 内容 | 原文与记录 |
| --- | --- |
| 项目来源及许可证 | [LICENSE](../LICENSE)、[COPYING](../COPYING)、[来源声明](../licenses/project/NOTICE.txt) |
| 生产依赖 | [完整第三方声明](../THIRD_PARTY_NOTICES.txt)、[依赖清单](../licenses/dependencies.json)、[原始文档目录](../licenses/runtime) |
| 字体与原生资源 | [资源清单](../licenses/assets.json)、[字体许可](../licenses/fonts) |
| Windows 安装器组件 | [分发清单](../licenses/distribution.json)、[分发声明](../licenses/distribution/NOTICE.txt) |
| 补充的上游许可原文 | [补充来源、版本与哈希](../licenses/supplements.json) |

依赖清单记录具体版本、许可证声明、原文路径、字节数和 SHA-256。缺失的上游文档只按清单中的明确版本与来源补充，不以通用模板替换原作者声明。打包会携带完整法律文件；Electron 和 Chromium 的原始声明也保持不变。

## 字体与设计资料

界面使用原始 Inter 4.1 可变字体及系统中文字体。Inter、Carlito 和 KaTeX 字体的 OFL 文本、作者及保留字体名称记录在资源清单中；KaTeX 渲染库的 MIT 许可与字体 OFL 许可分别保留。

参考资料中的 OpenAI Sans 未纳入分发包。界面字体因此与参考资料存在明确差异，具体采用范围见[设计对照](DESIGN-ALIGNMENT.md)。

## 安装器与原生组件

原生终端、NSIS 安装器及其组件各自保留原始许可、来源和固定输入哈希。来源档案与法律文件分别保存。已移除的 WinShell 组件不进入产品；快捷方式操作使用项目内的 NSIS 宏和原始 System 插件。

原始文档与输入哈希校验、实际启动器插件检查、安装后文件核对和便携运行检查分别执行。记录不代表所有历史二进制均已实现可重现构建；历史提权工具的来源边界保留在下方审计历史中。

## 验证与发布

```sh
pnpm notices:check
pnpm notices:release
pnpm test:package -- --installer
```

校验会检查原始法律文件、资源与分发组件哈希，并核对包内身份和编译产物。发布前还需要对应安装包和便携包的实际运行、正常退出、快捷方式以及保留数据的卸载证据。

当前结果见[包内审计](../verification/package-audit-result.json)、[实际安装记录](../verification/pipeline-installer-result.json)和[发布状态](RELEASE.md)。每份结果只证明其记录的 EXE、ASAR 与包装文件；更新源码后不能沿用旧包结果作为新包验收。

完整的来源调查、早期失败、历史批次数字与证据链接保留在[审计历史](LICENSES-HISTORY-2026-10-05.md)。历史记录中的品牌、版本和“当前”均指当时产物。
