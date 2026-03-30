# Crumb

A lightweight desktop code editor built with Tauri + React.

Crumb is a cross-platform code editor inspired by VS Code. It features a code editor, file explorer sidebar, and integrated terminal panel — all in a single desktop app.

## Features

- **Code editor** powered by CodeMirror 6 with syntax highlighting
- **File explorer** sidebar with recursive folder browsing
- **Integrated terminal** panel with support for multiple terminals and split views
- **Collapsible panels** — toggle the sidebar and bottom panel independently
- **Keyboard shortcuts** for common actions

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

- `Ctrl/Cmd + O` — Open a file
- `Ctrl/Cmd + S` — Save file
- `Ctrl/Cmd + B` — Toggle file explorer sidebar
- `Ctrl/Cmd + J` — Toggle bottom panel (terminal / output / problems)

## Project Structure

```
crumb/
├── src/                      # React frontend
│   ├── components/           # UI components
│   │   ├── Editor.tsx        # CodeMirror editor
│   │   ├── FileExplorer.tsx  # Sidebar file tree
│   │   ├── BottomPanel.tsx   # Tabbed panel container
│   │   ├── Terminal.tsx      # xterm.js terminal
│   │   ├── OutputPanel.tsx   # Build/runtime output
│   │   └── ProblemsPanel.tsx # Problem markers
│   ├── lib/
│   │   └── highlight.ts      # Syntax highlighting theme
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
