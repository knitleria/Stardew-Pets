# The Farmer creates the Twitch Rewards

Twitch lets an app change a Reward, pause it, and settle its Redemptions only for Rewards that app's `client_id` created. Creating both Rewards on connect would keep refunds and the pause under our control. The Farmer creates them instead, under two fixed titles, and the extension looks those titles up.

## Consequences

On connect the extension only checks that both titles are already on the channel. It does not create a Reward, and it does not change its cost, prompt, pause, or queue. A missing title is an error asking the Farmer to create it. While this window is connected it listens for Redemptions whether or not the channel is live. Redemptions that piled up while the extension was down are not fetched. Channel points exist only on Affiliate and Partner channels; everyone else gets a `403` and no Twitch features.
