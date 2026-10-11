import { worktreePreferencesSchema } from '../../contracts/project-worktrees';

type DirectorySelection = { canceled: boolean; filePaths: string[] };

export async function chooseWorktreeRoot(openDirectory: () => Promise<DirectorySelection>): Promise<string | null> {
  try {
    const selection = await openDirectory();
    if (selection.canceled) return null;
    if (selection.filePaths.length !== 1 || !selection.filePaths[0]) throw new Error('No single directory was selected.');
    return worktreePreferencesSchema.parse({ root: selection.filePaths[0] }).root;
  } catch (cause) {
    throw new Error('The worktree directory could not be selected. Try again.', { cause });
  }
}
