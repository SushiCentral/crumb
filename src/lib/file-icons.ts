const filenames: Record<string, string> = {
  'package.json': 'nodejs', 'package-lock.json': 'nodejs',
  'cargo.toml': 'rust', 'cargo.lock': 'rust', 'tauri.conf.json': 'tauri',
  '.gitignore': 'git', '.gitattributes': 'git', 'license': 'certificate',
  'license.md': 'certificate', 'license.txt': 'certificate',
};
const extensions: Record<string, string> = {
  ts: 'typescript', tsx: 'react_ts', js: 'javascript', jsx: 'react',
  mjs: 'javascript', cjs: 'javascript', rs: 'rust', md: 'markdown', markdown: 'markdown',
  css: 'css', html: 'html', json: 'json', toml: 'settings', yaml: 'yaml', yml: 'yaml',
  sh: 'console', bash: 'console', zsh: 'console', py: 'python',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'svg',
};
const folders: Record<string, string> = {
  src: 'src', tests: 'test', test: 'test', assets: 'images', public: 'public',
  '.github': 'github', node_modules: 'node', target: 'dist', dist: 'dist',
  build: 'dist', components: 'components', scripts: 'scripts', docs: 'docs',
};

/** Filename matches take precedence over extension matches; unknown items stay recognizable. */
export function fileTreeIcon(name: string, directory: boolean, expanded = false): string {
  const normalized = name.toLowerCase();
  if (directory) {
    const kind = folders[normalized];
    return `folder${kind ? `-${kind}` : ''}${expanded ? '-open' : ''}`;
  }
  return filenames[normalized] ?? extensions[normalized.split('.').pop() ?? ''] ?? 'document';
}
