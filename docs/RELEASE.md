# Windows 流水线发布

用户已授权：全部清理、能力整合、指定 UI 验收和分发验证完成后，直接通过流水线发布版本，无需再次确认。完成前不创建发布标签。

[Windows 工作流](../.github/workflows/windows.yml) 在分支提交、拉取请求和手动运行时验证代码；推送 `v<package.json 版本>` 标签时，验证成功后自动发布。当前只有 Windows x64 安装版和便携版经过实现；其他平台不在此工作流内。

验证按顺序执行固定版本依赖安装、类型检查、单元覆盖率、完整分发许可证检查、原始安装器输入校验、构建和 Windows 打包。随后检查实际应用目录、完整桌面回归、设置控件、安装器／卸载器／便携启动器中的原始插件、便携版的两次正常启动退出，以及隔离中文路径中的当前用户安装、完整已安装桌面回归、快捷方式元数据和卸载保留数据。已有安装、快捷方式或默认用户数据会使隔离安装检查停止。静默安装检查不代替图形安装向导验收。

发布标签必须与软件版本及实际构建提交一致。[准备脚本](../scripts/prepare-release.mjs) 只允许生成的验证记录与提交内容不同，核对应用目录、完整桌面、设置、便携版及安装版的 EXE／ASAR 校验值，并再次核对实际分发文件。源码压缩包由同一提交生成，包含原始开源许可证、法律文档和构建源码。

`CHANGELOG.md` 必须包含唯一的 `## [版本] - YYYY-MM-DD` 小节，以及有具体内容的“新功能”“变更与安全”“修复与完善”“安装”和 `English` 小节。发布前核对上一版本、提交和实际验证记录；首次独立版本不存在上一版本时明确记录，不沿用原项目的发布历史。

发布文件包括安装版、便携版、对应源码 ZIP、实际验证记录、中英文更新说明及 `SHA256SUMS.txt`。发布任务先核对下载文件的校验值，再上传全部文件，最后自动将完整版本公开。失败时保留草稿供同一提交重试；已经公开或属于其他提交的版本不会被覆盖。

构建任务只有读取仓库的权限，发布任务在所有验证成功后获得发布所需权限。四项官方 GitHub Actions 均固定到完整提交校验值，版本来源分别为 [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)、[setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)、[upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) 和 [download-artifact v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1)。

当前 515 项测试、类型检查和发布许可证检查均通过。发布策略的 23 项测试、模板转换的 10 项测试达到 100% 覆盖率，工作流结构及 8 个 PowerShell 命令块通过语法检查。新版安装版通过完整 173 项桌面回归和保留用户数据的实际卸载；设置的 4 项检查及便携版的两次实际启动、退出、长路径清理通过。全部 261 个解包文件逐项核对原始字节，Inter 替换后的 19 张聊天／项目／设置截图已重新检查。见 [流水线验证记录](../verification/release-pipeline-result.json) 和 [长路径修复记录](../verification/portable-cleanup-review-result.json)。

Git Credential Manager 的现有会话已通过 GitHub API 验证。独立源码快照、远端和托管流水线仍需建立；其余能力／UI 与原生向导／文件选择验收、发布说明和源码历史清理仍需完成。没有发布版本。
