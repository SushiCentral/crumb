export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export function parseRecentProjects(raw: string | null): RecentProject[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentProject => item != null
      && typeof item.path === 'string' && item.path.length > 0
      && typeof item.name === 'string' && typeof item.lastOpened === 'number'
      && Number.isFinite(item.lastOpened)).slice(0, 15);
  } catch { return []; }
}

export function recordProject(projects: RecentProject[], directory: string, now = Date.now()): RecentProject[] {
  const path = /^[a-z]:[/\\]$/i.test(directory) ? directory : directory.replace(/[/\\]+$/, '') || '/';
  const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
  return [{ path, name, lastOpened: now }, ...projects.filter(project => project.path !== path)].slice(0, 15);
}
