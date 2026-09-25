# The extension creates the Twitch rewards itself

Twitch lets an app update a redemption's status only for rewards that its own `client_id` created, and that one rule covers marking a Redemption fulfilled, refunding its points, and fetching redemptions missed while the extension was offline. Letting the Farmer point us at rewards they made in the Twitch dashboard would therefore cost us refunds, queue hygiene and backfill all at once, so the extension creates and owns both Rewards on first connect, and only their cost is configurable.

Owning the Rewards also means owning when they may be redeemed. They are redeemable only while the channel is genuinely live and the extension is running, and sit visible but paused the rest of the time, so points can never be spent on a farm nobody is watching. Twitch does not document whether an offline channel accepts redemptions at all, which is another reason not to leave the question open.

This decision is recorded ahead of the implementation: no code creates or owns a Reward yet, and nothing below describes behaviour the extension has today.

## Consequences

Each Reward's title must be unique across every reward on the channel, so a leftover reward with the same title blocks setup until the Farmer renames or deletes it, and later launches must look up the Rewards we already own instead of creating them again. Rewards are created disabled, because Twitch accepts the paused flag only on update. Rewards cannot skip the request queue, because only `UNFULFILLED` redemptions can be refunded. If the extension dies without pausing, redemptions accumulate until the next connect. Channel points exist only on Affiliate and Partner channels; everyone else gets a `403` and no Twitch features at all.
