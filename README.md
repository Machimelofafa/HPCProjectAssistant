# HPC/AI Project Planner

This is an offline-first project planning tool designed for High-Performance Computing (HPC) and AI projects.
The app is delivered as a static web page (index.html) with supporting assets under the `assets/` directory.

## How to Use

1.  **Download:** Save the entire project folder (`index.html` and the `assets/` directory) to your local machine.
2.  **Open:** Open the `index.html` file in your web browser.
3.  **Use:** The application is now ready to use, completely offline.

## Features

### Project Settings Toolbar

All project settings, filters, and tools are now located in a new toolbar in the center of the header. This includes:

*   **Project Calendar:** Set the project start date, calendar type, holidays, and slack threshold.
*   **Filter & Group:** Filter tasks by name or phase, and group them in the timeline view.
*   **Subsystem Legend:** Toggle visibility of tasks based on their subsystem.
*   **Edit Selected:** Perform quick edits on selected tasks.
*   **Bulk Edit:** Apply changes to multiple selected tasks at once.
*   **Template:** Insert pre-defined sets of tasks into your project.
*   **Validation:** View warnings and errors in your project plan.
*   **Legend:** View a key for the different symbols and colors used in the application.

### Keyboard Shortcuts

*   **Zoom:** Use `Ctrl` + `Mouse Wheel` to zoom in and out of the timeline and dependency graph.
*   **Pan:** Use the `Mouse Wheel` to pan vertically and `Shift` + `Mouse Wheel` to pan horizontally. You can also click and drag the canvas to pan.
*   **Selection:**
    *   `Click`: Select a single task.
    *   `Shift` + `Click`: Add or remove a task from the selection.
    *   `Ctrl` + `A`: Select all tasks.
*   **Actions:**
    *   `Ctrl`/`Cmd` + `Z`: Undo
    *   `Ctrl`/`Cmd` + `Y`: Redo
    *   `Delete`: Delete selected tasks.
    *   `Ctrl`/`Cmd` + `D`: Duplicate selected tasks.
    *   `?` or `F1`: Show the help dialog.

### Export/Import

You can export your project plan to a JSON file and import it back into the tool. This is useful for sharing your plan with others or for version control.

*   **Export:** Click the "Action" button in the header and select "Export JSON".
*   **Import:** Click the "Action" button and select "Import JSON".

### Baselines

The baselines feature allows you to save a snapshot of your project plan and compare it to the current version. This is useful for tracking changes and understanding the impact of delays or scope changes.

*   **Create a Baseline:** Go to the "Compare" tab, enter a name for your baseline, and click "Save new baseline".
*   **Compare:** Select a baseline from the dropdown and click "Use Selected". The comparison view will show you the differences between the baseline and your current plan.

### Accessibility

*   The application includes features to ensure it is accessible to users with disabilities.
*   **Keyboard Navigation:** All interactive elements are focusable and can be operated with the keyboard.
*   **Screen Reader Support:** ARIA attributes are used to provide screen reader users with information about the UI elements and their state.
*   **High Contrast Theme:** A high-contrast theme is available for users with low vision. You can toggle the theme by clicking the "Theme" button in the header.

## Feedback

We welcome your feedback! If you have any suggestions or find any bugs, please [open an issue on our GitHub page](https://github.com/user-repo/job-12-polish-docs/issues).
