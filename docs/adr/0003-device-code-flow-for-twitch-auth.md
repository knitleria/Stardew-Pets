# Twitch auth uses the Device Code Flow as a public client

The obvious choice, an authorization code flow against a `http://localhost` redirect, requires a client secret at the token exchange, and a secret shipped inside an extension that runs on the Farmer's machine is not a secret. Twitch's Device Code Flow needs no secret for a public client and is what Twitch recommends for desktop apps, so the extension shows a short code that the Farmer types into `twitch.tv/activate`.

## Consequences

Twitch access tokens last about four hours, and a public client's refresh token dies after a long absence, so both have to be handled without a secret. The extension refreshes silently one minute before expiry and replaces the stored refresh token on every refresh, because a refresh token is single-use. A rejected refresh starts the device code again immediately, including at startup.
