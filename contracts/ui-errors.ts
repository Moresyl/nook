const knownErrors = new Map<string, string>([
  ['Local data could not be saved. Check disk space and directory permissions.', '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'],
  ['The cron expression or time zone is invalid or has no future run.', 'Cron 表达式或时区无效，或没有未来的执行时间。'],
  ['Assistant profiles could not be saved. Check disk space and directory permissions, or choose fewer assistants.', '助手配置未能保存。请检查磁盘空间和文件夹权限，或减少导出的助手数量。'],
  ['Prompt templates could not be saved. Check disk space and directory permissions, or export fewer templates.', '提示模板未能保存。请检查磁盘空间和文件夹权限，或减少导出的模板数量。'],
  ['The original document could not be saved. Check disk space and directory permissions.', '原始文档未能保存。请检查磁盘空间和文件夹权限，再重试。'],
]);

export function uiErrorMessage(problem: unknown, fallback = '操作失败，请重试。'): string {
  const raw = problem instanceof Error ? problem.message : typeof problem === 'string' ? problem : fallback;
  const message = raw.replace(/^Error invoking remote method '[^']+': Error: /, '');
  return knownErrors.get(message) ?? (message || fallback);
}
