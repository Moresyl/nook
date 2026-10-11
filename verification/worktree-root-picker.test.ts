import { describe, expect, it, vi } from 'vitest';
import { chooseWorktreeRoot } from '../desktop/services/worktree-root-picker';
import { uiErrorMessage } from '../contracts/ui-errors';

describe('worktree root directory selection', () => {
  it.each(['E:\\项目 工作树 🧭', '/workspace/工作树', '\\\\server\\share\\工作树'])('returns the selected absolute path literally: %s', async root => {
    const open = vi.fn().mockResolvedValue({ canceled: false, filePaths: [root] });
    expect(await chooseWorktreeRoot(open)).toBe(root);
    expect(open).toHaveBeenCalledExactlyOnceWith();
  });

  it('returns null after cancellation without inspecting stale paths', async () => {
    expect(await chooseWorktreeRoot(async () => ({ canceled: true, filePaths: ['relative'] }))).toBeNull();
  });

  it.each([[], [''], ['relative'], ['C:relative'], ['E:\\ok', 'E:\\extra'], ['E:\\bad\npath'], ['E:\\' + 'x'.repeat(4096)]].map(filePaths => ({ filePaths })))('rejects invalid directory selections without exposing their contents: $filePaths', async ({ filePaths }) => {
    const error = await chooseWorktreeRoot(async () => ({ canceled: false, filePaths })).catch(failure => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('The worktree directory could not be selected. Try again.');
    expect(uiErrorMessage(error)).toBe('未能选择工作树文件夹，请重试。');
    expect(uiErrorMessage(`Error invoking remote method 'qiyao:invoke': Error: ${error.message}`)).toBe(uiErrorMessage(error));
  });

  it('retains a rejected dialog cause for diagnostics while returning safe UI feedback', async () => {
    const cause = new Error('SECRET_PATH PRIVATE_KEY');
    const error = await chooseWorktreeRoot(async () => { throw cause; }).catch(failure => failure);
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('SECRET');
    expect(uiErrorMessage(error)).toBe('未能选择工作树文件夹，请重试。');
  });

  it('awaits the native selection without inventing a path or settling early', async () => {
    let finish!: (result: { canceled: boolean; filePaths: string[] }) => void;
    const held = new Promise<{ canceled: boolean; filePaths: string[] }>(resolve => { finish = resolve; });
    const settled = vi.fn();
    const operation = chooseWorktreeRoot(() => held).then(settled);
    await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    finish({ canceled: false, filePaths: ['E:\\工作树'] }); await operation;
    expect(settled).toHaveBeenCalledExactlyOnceWith('E:\\工作树');
  });
});
