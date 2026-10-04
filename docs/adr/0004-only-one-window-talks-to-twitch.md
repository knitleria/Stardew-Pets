# Only one editor window talks to Twitch

The farm lives in global storage, so every open editor window shares it. Only the window that takes a lock file next to the save file talks to Twitch and answers Redemptions. Save-file writes are separately serialised through a short-lived lock, always start from the latest file contents, and every window watches the file for changes so a Pet arriving in one window appears immediately in the others.

## Consequences

The first window to start takes `twitch.lock` beside the save, even before it has a token, and nothing in the interface says which window that is. Connect in any other window does not toast; the only trace is a line in the Stardew Pets output channel. A lock left by a process that has already exited can be taken. Other windows do not open a second EventSub connection. A Pet appended to the save appears in those windows on its own; a removal, or any other change to the pet list, reloads the farm view. A write of money or decoration starts from the latest file, so it cannot drop a Pet that just arrived.
