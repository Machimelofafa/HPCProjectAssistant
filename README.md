# HPC Project Assistant

HPC Project Assistant is a single‑file planner for high‑performance computing and AI projects. The entire app lives in `index.html` and runs completely in your browser.

## Usage

1. Download or clone this repository.
2. Open `index.html` in any modern browser – no build step or server is required.
3. Plan your project offline. Data is stored in your browser's local storage.

## Keyboard & Mouse Shortcuts

| Action | Shortcut |
| --- | --- |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Y` |
| Delete selected tasks | `Delete` |
| Duplicate selected tasks | `Ctrl/Cmd + D` |
| Move selection | `↑` / `↓` |
| Open Action menu | `Ctrl/Cmd + Shift + A` or click **Action** |
| Show help | `?` or `F1` |
| Zoom timeline/graph | `Ctrl + Scroll` |
| Pan view | `Scroll` or drag (`Shift + Scroll` for horizontal) |

## Export, Import & Baselines

Use the **Action** menu to:

- **Export JSON** – Save the current project to a file.
- **Import JSON** – Load a project from a file.
- **Export PNG** – Save a snapshot of the timeline.

Baselines capture project snapshots for comparison. Save up to five baselines locally and switch between them using the baseline controls in the sidebar.

## Accessibility

- All controls are keyboard accessible and include ARIA labels.
- Live regions announce updates such as selections or save status.
- Zoom controls and a dark theme aid low‑vision users.

## Feedback

Have ideas or found a bug? Please open an issue on the [GitHub Issues page](https://github.com/your-org/HPCProjectAssistant/issues).
