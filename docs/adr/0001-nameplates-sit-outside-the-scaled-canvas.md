# Nameplates sit outside the scaled canvas

The canvas is scaled with `stardew-pets.scale`, so a Nameplate drawn on it in game units is scaled too and stops being sharp. Nameplates are HTML above the canvas, outside that transform. Each frame the Pet's game position is multiplied by the scale and written as screen pixels, which is what keeps the plate lined up with the sprite.

## Consequences

A Nameplate stays the same size at every scale, and it is clamped so the whole plate remains on screen, including when the Pet stands against the top edge. A long Name is stored whole and the plate ends it with an ellipsis. The plates ignore clicks. They are hidden in decor mode and when `stardew-pets.showNames` is off. The typeface is the Stardew font with a sans-serif fallback.
