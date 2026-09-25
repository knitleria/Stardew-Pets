# Nameplates are drawn on the canvas, not as DOM elements

The farm view is a single double-buffered canvas of sprites; until now no text was ever drawn on it, while every piece of text in the extension (money, store, menus) is HTML layered over that canvas. Nameplates could have followed the HTML precedent, but they have to track a moving sprite every frame, so we draw them on the canvas with the StardewValley font instead of introducing a second coordinate system that would need constant syncing and would drift at non-default `stardew-pets.scale` values.

## Consequences

Nameplates inherit canvas behaviour: they scale with the pets and are clipped by the canvas bounds at the sides, while at the top the drawing code floors the anchor, so a pet standing against the top edge of the farm wears its name over its own sprite rather than losing it off the canvas. Text rendering is ours to handle, including truncation and any glyph the font lacks, with no CSS fallback available.
