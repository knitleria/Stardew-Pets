# Stardew Pets

A VS Code extension that keeps a small farm of Stardew Valley animals in a sidebar view. Animals can be added by the person using the editor, or requested by viewers of that person's Twitch stream.

## The farm

**Farmer**:
The person using the editor. There is exactly one, and the farm belongs to them.
_Avoid_: Owner, user, streamer

**Pet**:
A single animal living on the farm. Has a Name, a Specie and a Variant.
_Avoid_: Animal, creature

**Specie**:
The kind of animal a Pet is, such as Cat, Cow or Junimo. Chosen once and never changes.
_Avoid_: Type, breed, kind

**Variant**:
Which version of a Specie a Pet is. Depending on the Specie this is a colour (`Black`), an age (`Baby`), both (`Brown Adult`), or nothing at all.
_Avoid_: Color, breed, skin, age

**Name**:
The label a Pet is known by, shown on its Nameplate. Chosen by the Farmer when adding a Pet by hand, or taken from the Viewer's Twitch display name when the Pet arrives through a Redemption.
_Avoid_: Title, nickname, username

**Nameplate**:
The Name as drawn above a Pet in the farm view.
_Avoid_: Label, tag, tooltip

## Twitch

**Viewer**:
Someone watching the Farmer's Twitch stream, identified by their Twitch account. A Pet that came from a Redemption remembers which Viewer asked for it.
_Avoid_: User, chatter, subscriber

**Reward**:
A Twitch channel points reward the extension puts on the Farmer's channel. There are two: one adds a Pet to the farm, one takes one of the Viewer's own Pets away.
_Avoid_: Prize, product, item

**Redemption**:
A Viewer spending channel points on a Reward. Each Redemption is either honoured or refunded; there is nothing in between.
_Avoid_: Purchase, order, request
