# Only one editor window talks to Twitch

The save lives in global storage, so every open editor window reads and writes the same farm. Left alone, two windows would each answer the same Redemption with their own Pet and then overwrite each other's save. Rather than synchronise the save across windows, which is a much larger piece of work, the window that takes a lock file next to the save owns the Twitch connection and the others run exactly as they do today, with no Twitch at all.

## Consequences

Which window drives Twitch is whichever one started first, and nothing in the interface explains that. Two windows still write the same save on unrelated actions, so the pre-existing last-writer-wins behaviour is untouched; this decision deliberately does not fix it.
