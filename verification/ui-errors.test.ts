import { describe, expect, it } from 'vitest';
import { uiErrorMessage } from '../contracts/ui-errors';

describe('Chinese UI error copy', () => {
  it('localizes the sanitized IPC storage failure without exposing or mutating its diagnostic cause', () => {
    const message = 'Local data could not be saved. Check disk space and directory permissions.';
    const cause = Object.assign(new Error('SECRET_PATH and PRIVATE_KEY'), { path: 'SECRET_PATH', key: 'PRIVATE_KEY' });
    const error = new Error(`Error invoking remote method 'qiyao:invoke': Error: ${message}`, { cause });
    expect(uiErrorMessage(error)).toBe('本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。');
    expect(uiErrorMessage(new Error(message))).toBe(uiErrorMessage(error));
    expect(error.message).toBe(`Error invoking remote method 'qiyao:invoke': Error: ${message}`);
    expect(error.cause).toBe(cause);
  });

  it('keeps schedule validation actionable while translating only its recognized complete message', () => {
    const message = 'The cron expression or time zone is invalid or has no future run.';
    expect(uiErrorMessage(new Error(message))).toBe('Cron 表达式或时区无效，或没有未来的执行时间。');
    expect(uiErrorMessage(`Error invoking remote method 'qiyao:invoke': Error: ${message}`)).toBe(uiErrorMessage(message));
    expect(uiErrorMessage(`${message} Additional provider detail.`)).toBe(`${message} Additional provider detail.`);
  });

  it('retains the operation-specific recovery choices for assistant, template and original-document saves', () => {
    expect(uiErrorMessage(new Error('Assistant profiles could not be saved. Check disk space and directory permissions, or choose fewer assistants.'))).toBe('助手配置未能保存。请检查磁盘空间和文件夹权限，或减少导出的助手数量。');
    expect(uiErrorMessage(new Error('Prompt templates could not be saved. Check disk space and directory permissions, or export fewer templates.'))).toBe('提示模板未能保存。请检查磁盘空间和文件夹权限，或减少导出的模板数量。');
    expect(uiErrorMessage(new Error('The original document could not be saved. Check disk space and directory permissions.'))).toBe('原始文档未能保存。请检查磁盘空间和文件夹权限，再重试。');
    expect(uiErrorMessage(new Error('The project file could not be saved. Check disk space and directory permissions.'))).toBe('项目文件未能保存，草稿已保留。请检查磁盘空间和文件夹权限，再重试。');
  });

  it('preserves unknown model and Unicode errors literally, including prototype-like messages', () => {
    for (const message of ['Provider returned HTTP 429: retry later.', '精确中文与 emoji 🧭', '<script>literal error</script>', '__proto__', 'constructor', 'toString']) {
      expect(uiErrorMessage(new Error(message))).toBe(message);
      expect(uiErrorMessage(`Error invoking remote method 'qiyao:invoke': Error: ${message}`)).toBe(message);
    }
  });

  it('uses a bounded fallback for empty and opaque failures without reading arbitrary objects', () => {
    const opaque = { get message(): never { throw new Error('Do not read private details'); }, toString(): never { throw new Error('Do not serialize private details'); } };
    for (const problem of [undefined, null, false, 0, opaque, '', new Error(''), "Error invoking remote method 'qiyao:invoke': Error: "]) {
      expect(uiErrorMessage(problem)).toBe('操作失败，请重试。');
      expect(uiErrorMessage(problem, '原件保存失败，请重试。')).toBe('原件保存失败，请重试。');
    }
  });
});
