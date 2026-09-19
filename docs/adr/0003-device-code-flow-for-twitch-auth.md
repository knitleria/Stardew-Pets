# Twitch auth uses the Device Code Flow as a public client

The obvious choice, an authorization code flow against a `http://localhost` redirect, requires a client secret at the token exchange, and a secret shipped inside an extension that runs on the Farmer's machine is not a secret. Twitch's Device Code Flow needs no secret for a public client and is what Twitch recommends for desktop apps, so the extension shows a short code that the Farmer types into `twitch.tv/activate`.

This decision is recorded ahead of the implementation: no Twitch authentication code has been written, and nothing below describes behaviour the extension has today.

## Consequences

Access tokens last four hours and are refreshed silently, but a public client's refresh token dies after 30 days of inactivity, so a Farmer returning from a long break has to enter a code again. Refresh tokens are single-use, so each refresh must replace the stored one or the connection is lost.
