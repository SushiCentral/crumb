# Crumb

A lightweight desktop code editor built with Tauri + React.

Crumb is a cross-platform code editor inspired by VS Code. It features a code editor, file explorer sidebar, and integrated terminal panel — all in a single desktop app.

## Features

- **Code editor** powered by CodeMirror 6 with syntax highlighting selected from the file name
- **Indentation guides** — subtle vertical lines that respect indentation width and tabs, including through blank lines. Enabled by default; toggle them in Settings → Editor.
- **File explorer** sidebar with recursive folder browsing
- **Integrated terminal** panel with support for multiple terminals and split views; new terminals start in the Explorer folder
- **Resizable panels** — drag the sidebar and bottom panel edges, or toggle them independently
- **Keyboard shortcuts** for common actions
- **Color themes** for the full interface, editor syntax, and terminal
- **Command palette** for themes, layout, font size, and file actions

## Tech Stack

- **Framework:** [Tauri 2](https://tauri.app/)
- **Frontend:** React 19 + TypeScript + Vite
- **Editor:** [CodeMirror 6](https://codemirror.net/)
- **Terminal:** [xterm.js](https://xtermjs.org/)
- **Backend:** Rust (portable-pty)

## Prerequisites

- **Rust** — install via [rustup](https://rustup.rs/)
- **Node.js 18+** — download from [nodejs.org](https://nodejs.org)

For OS-specific tooling (WebView2, Xcode, Linux system libs, etc.), see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Getting Started

```bash
# Clone the repository
git clone https://github.com/YourUsername/crumb.git
cd crumb

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri:dev
```

## Available Scripts

- `npm run tauri:dev` — Run the app in development mode
- `npm run build` — Build the frontend for production
- `npm run preview` — Preview the production frontend build

## Keyboard Shortcuts

- `Ctrl/Cmd + =` / `-` — Zoom the whole interface in / out (50–200%)
- `Ctrl/Cmd + Shift + =` / `-` — Increase / decrease editor and terminal font size
- `Ctrl/Cmd + 0` — Reset interface zoom to 100%
- `Ctrl/Cmd + Shift + 0` — Reset editor and terminal font size to 13px
- `Ctrl/Cmd + O` — Open a file
- `Ctrl/Cmd + P` — Search filenames in the open folder and open tabs. On Windows/Linux, keep holding `Ctrl` and press `P` again to move down the results, wrapping from the last file to the first; releasing `Ctrl` after at least one extra press opens the selected file. The press that opens the picker never opens a file on release, and `Cmd + P` on macOS keeps its existing open-only behavior.
- `Ctrl/Cmd + S` — Save file
- `Ctrl/Cmd + N` — New untitled tab
- `Ctrl/Cmd + W` — Close the current tab (prompts for unsaved changes)
- `Ctrl/Cmd + Tab` — Switch tabs (`Shift` goes backward)
- `Ctrl/Cmd + B` — Toggle sidebar visibility without changing the active Explorer or Search tab. `Ctrl + B` also works from the Search query and a focused Vim editor, where it takes precedence over Vim's Ctrl-B page-back; `Ctrl + Shift + B` is not a sidebar shortcut.
- `Ctrl + Shift + E` — Show the Explorer, or hide the sidebar when Explorer is already active. When Search is the active sidebar tab, this switches to Explorer instead of closing. This works from a focused Vim editor (Normal or Insert) and from the Search query input.
- `Ctrl + Shift + F` — Toggle Search in Files and focus the query. Pressing it while Search is active closes the sidebar and returns focus to the editor. These sidebar chords are `Ctrl`-only and do not use `Meta`/`Super` or `Alt`; plain `Ctrl + E` is not a Crumb shortcut.
- `Ctrl + \`` — Toggle the bottom panel; opening selects Terminal and focuses its input, closing returns to the editor
- `Ctrl/Cmd + Shift + P` — Open the command palette

`Ctrl+H`, `Ctrl+J`, `Ctrl+K`, and `Ctrl+L` are not Crumb or editor shortcuts. They are left to focused terminals and ordinary text inputs, and are swallowed in the editor so CodeMirror/Vim defaults cannot edit or navigate the document.

## Themes and commands

Settings (`Ctrl/Cmd + ,`) has Appearance, Editor, Terminal, and Workspace tabs. Hover or focus a theme card to preview it; click to save it. Editor preferences include line numbers, bracket matching and closing, active-line highlighting, wrapping, and 2/3/4-character indentation with spaces or tabs. Changes preserve undo history and are restored on restart. Terminal prompt clearing is optional and off by default; it applies to new terminals only.

The status bar shows the active editor's cursor and selection, indentation, UTF-8 encoding, actual line-ending format, language, wrapping, zoom, and theme. Sidebar width, panel height, sidebar tab, and zoom are remembered. Workspace settings includes Reset layout, which restores panel sizes and visibility without changing fonts, zoom, or themes.

Open the command palette with `Ctrl/Cmd + Shift + P`, then choose **Preferences: Color Theme**. Crumb includes Crumb, One Dark, Dracula, Catppuccin Mocha, Catppuccin Latte, Nord, Tokyo Night, Gruvbox Dark, Rosé Pine, and Solarized Light. Themes color the entire workspace and set an interface and code font. Choose **Preferences: Editor Font** to override the code font for the editor and terminal, or return to the theme default. Fonts are bundled for offline use. Theme, font choice, and font size are saved locally and restored on restart.

The palette also lets you toggle the terminal and file tree, change or reset the editor and terminal font size, open or save a file, and open the selected terminal's current folder.

Files open in separate tabs. Each tab keeps its own edits and undo history. The explorer lets you create files and folders from its toolbar, or use a file or folder's context menu to create, rename, or delete items. The tree refreshes when files change outside Crumb.

Word wrap is on by default and can be toggled through **Editor: Enable/Disable Word Wrap** in the command palette. Right-click a file tab or a file in the explorer and choose **Open in Split View** to open another editor pane. Splits can be repeated for any open file, dragged wider or narrower, and closed individually. Switching tabs changes the active editor pane without replacing other panes.

When a Markdown file is active, the top bar shows **Preview**. It opens a rendered pane beside the editors and updates as you type. The preview supports GitHub-style tables and task lists, images stored beside the file, and links. Click **Preview** again to close that pane. A Markdown preview can stay open while you add more editor splits. The same action is available in the command palette.

Opening a folder with **Open Folder** updates the Explorer and recent projects without opening, focusing, or spawning a terminal. **Terminal folder** only changes the Explorer folder. The top search bar finds files by name in the open folder; unsupported file types open as plain text.

The color palettes are inspired by [One Dark Pro](https://github.com/Binaryify/OneDark-Pro), [Dracula](https://github.com/dracula/dracula-theme), [Catppuccin](https://github.com/catppuccin/palette), [Nord](https://github.com/nordtheme/nord), [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme), [Gruvbox](https://github.com/morhetz/gruvbox), [Rosé Pine](https://github.com/rose-pine/rose-pine-theme), and [Solarized](https://github.com/altercation/solarized). Crumb arranges interface colors for its own layout. Bundled fonts are Inter, Space Grotesk, JetBrains Mono, IBM Plex Mono, and Fira Code.

## Project Structure

```
crumb/
├── src/                      # React frontend
│   ├── components/           # UI components
│   │   ├── Editor.tsx        # CodeMirror editor
│   │   ├── FileExplorer.tsx  # Sidebar file tree
│   │   ├── QuickOpen.tsx     # Top bar file search
│   │   ├── BottomPanel.tsx   # Tabbed panel container
│   │   ├── Terminal.tsx      # xterm.js terminal
│   │   ├── OutputPanel.tsx   # Build/runtime output
│   │   └── ProblemsPanel.tsx # Problem markers
│   ├── lib/
│   │   ├── highlight.ts      # Syntax highlighting theme
│   │   └── languages.ts      # File language detection
│   ├── App.tsx               # Root layout
│   └── main.tsx             # React entry point
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── lib.rs           # PTY commands and Tauri setup
│   │   └── main.rs          # Rust entry point
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── public/                  # Static assets
└── package.json              # Node dependencies
```

## Contributing

Contributions are welcome. Feel free to open issues or submit pull requests.

## License

No license file is currently defined in this repository.
