const knownErrors = new Map<string, string>([
  ['Worktree cleanup is running. Retry after it finishes.', '工作树管理正在处理其他操作，请完成后重试。'],
  ['The workspace is busy. Retry worktree cleanup after current actions finish.', '工作区正在处理其他操作，请完成后重试。'],
  ['The linked worktree project changed. Refresh the worktree list.', '关联项目已变更，请刷新工作树列表后重试。'],
  ['The linked worktree conversation changed. Refresh the worktree list.', '关联会话已变更，请刷新工作树列表后重试。'],
  ['The current chat changed. Retry the worktree navigation.', '当前聊天已变更，请重新打开项目聊天。'],
  ['The worktree directory could not be selected. Try again.', '未能选择工作树文件夹，请重试。'],
  ['The default worktree directory could not be prepared. Choose an existing root folder in settings.', '默认工作树目录未能准备。请在设置中选择已有文件夹，再重试。'],
  ['Local data could not be saved. Check disk space and directory permissions.', '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'],
  ['Desktop settings could not be saved. Check local storage and try again.', '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'],
  ['The cron expression or time zone is invalid or has no future run.', 'Cron 表达式或时区无效，或没有未来的执行时间。'],
  ['Assistant profiles could not be saved. Check disk space and directory permissions, or choose fewer assistants.', '助手配置未能保存。请检查磁盘空间和文件夹权限，或减少导出的助手数量。'],
  ['Prompt templates could not be saved. Check disk space and directory permissions, or export fewer templates.', '提示模板未能保存。请检查磁盘空间和文件夹权限，或减少导出的模板数量。'],
  ['The original document could not be saved. Check disk space and directory permissions.', '原始文档未能保存。请检查磁盘空间和文件夹权限，再重试。'],
  ['The project file could not be saved. Check disk space and directory permissions.', '项目文件未能保存，草稿已保留。请检查磁盘空间和文件夹权限，再重试。'],
]);

export function uiErrorMessage(problem: unknown, fallback = '操作失败，请重试。'): string {
  const raw = problem instanceof Error ? problem.message : typeof problem === 'string' ? problem : fallback;
  const message = raw.replace(/^Error invoking remote method '[^']+': Error: /, '');
  return knownErrors.get(message) ?? (message || fallback);
}
