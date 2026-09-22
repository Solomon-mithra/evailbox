export const workspaceIds = ['PERSONAL', 'WORK'] as const;
export type WorkspaceId = (typeof workspaceIds)[number];
export const workspaceNames: Record<WorkspaceId, string> = { PERSONAL: 'Personal', WORK: 'Work' };
export function workspacePath(path: string, workspace: WorkspaceId) {
  return path + (path.includes('?') ? '&' : '?') + 'workspace=' + workspace;
}
