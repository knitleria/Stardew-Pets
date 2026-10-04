# Only one editor window talks to Twitch

The farm lives in global storage, so every open editor window shares it. Only the window that takes a lock file next to the save file talks to Twitch and answers Redemptions. Save-file writes are separately serialised through a short-lived lock, always start from the latest file contents, and every window watches the file for changes so a Pet arriving in one window appears immediately in the others.

## Consequences

Which window drives Twitch is whichever one started first, and nothing in the interface explains that. Other windows do not open duplicate EventSub connections, but their farm views stay current and unrelated writes such as money or decoration changes cannot overwrite a newly arrived Pet with stale state.
