# Pet Nameplates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw every Pet's Name above it in the farm view, with a setting to turn the Nameplates off.

**Status:** The code is complete and committed. The visual verification — every "Look at it" step below — is still outstanding, so those steps stay unticked.

**Architecture:** The farm view is a webview running a canvas game loop. `PetCharacter.draw` already draws the sprite and then asks its AI to draw a mood emote on top; the Nameplate slots into that same method as a `fillText` call in game units, so it scales with the pets for free. A new `stardew-pets.showNames` setting travels from the extension host to the webview as a message, exactly like the existing `background`, `scale` and `monsters` settings.

**Tech Stack:** TypeScript (strict), esbuild, VS Code webview API, Canvas 2D.

## Global Constraints

- Nameplates are drawn on the canvas, never as DOM elements. See `docs/adr/0001-nameplates-drawn-on-the-canvas.md`.
- `media/main.js` is a build artefact produced by `npm run build-game`. Never edit it by hand.
- TypeScript runs with `"strict": true`. `npm run compile` must stay clean.
- No new runtime or dev dependencies.
- Use the vocabulary in `CONTEXT.md`: a **Pet** has a **Name**, drawn as a **Nameplate**. The second half of a pet's identity is a **Variant**, even though the save field is called `color`.
- This repo has no test runner. Every task is verified by building and looking at the result in the Extension Development Host.
- Out of scope, belongs to the Twitch work: the `twitchUserId` save field, and falling back to a Twitch login when a display name has glyphs the font lacks.

### How to verify anything in this plan

1. Press <kbd>F5</kbd> in VS Code (the `Run Extension` launch config runs `build-all` first).
2. In the new window, open the Explorer sidebar and find the **Stardew Pets 😸** view.
3. If the farm has no pets, run the `Add pet` command from the view's title bar and add two or three.

To pick up a change without restarting, rebuild with `npm run build-game` and run `Developer: Reload Window` in the Extension Development Host.

---

### Task 1: Draw the Nameplate

**Files:**
- Modify: `src/game/entities/pets.ts` (add a getter to `PetAI`, add the Nameplate to `PetCharacter`)
- Modify: `src/game/engine.ts:849-864` (preload the font in `Game.start`)

**Interfaces:**
- Produces: `PetAI.moodElevation: number` — how far above (negative) or below (positive) the sprite's top edge this specie's emote hangs.
- Produces: `PetCharacter.nameFontSize: number`, `PetCharacter.nameGap: number` — static constants later tasks reuse.

> **Amended after review.** `#drawName` originally returned the height it used, for Task 3 to lift the emote by. Task 3 was dropped, so the method returns nothing. The snippet in Step 3 shows the method as it finally shipped, which includes the vertical clamp, the truncation Task 2 adds and the `showNames` guard Task 4 adds.

- [x] **Step 1: Expose the mood elevation from the AI**

Every specie has its own `moodElevation` because sprites have different amounts of transparent padding, and the Nameplate has to hang off the same anchor as the emote or it will float in empty space above a short pet.

In `src/game/entities/pets.ts`, inside `class PetAI`, directly below the private field block that starts with `#moodSprite`, add:

```ts
    get moodElevation(): number { return this.#moodElevation; }
```

- [x] **Step 2: Add the Nameplate constants**

In `src/game/entities/pets.ts`, inside `class PetCharacter`, directly below the `get color(): string { return this.#color; }` line, add:

```ts
    //Name plate
    static nameFontSize: number = 8;
    static nameGap: number = 2;
```

- [x] **Step 3: Draw the Nameplate**

Still in `class PetCharacter`, replace the whole `draw` method:

```ts
    //Rendering
    draw(ctx: CanvasRenderingContext2D, options: any) {
        //Draw character
        super.draw(ctx, options);

        //Draw AI mood
        this.ai.drawMood(ctx);
    }
```

with:

```ts
    //Rendering
    draw(ctx: CanvasRenderingContext2D, options: any = {}) {
        //Draw character
        super.draw(ctx, options);

        //Drawing into the alpha test canvas -> Nothing above the sprite counts as clickable
        if (typeof options === 'object' && typeof options.pos === 'object') return;

        //Draw name
        this.#drawName(ctx);

        //Draw AI mood
        this.ai.drawMood(ctx);
    }

    #drawName(ctx: CanvasRenderingContext2D) {
        //Names are hidden
        if (!Game.showNames) return;

        //Get text
        const text = Util.truncate(Util.stripAccents(this.name), PetCharacter.nameMaxChars);

        //Nothing to draw
        if (!text) return;

        //Get position
        const x = Math.round(this.pos.x + this.size.x / 2);
        const yAnchor = Math.round(this.pos.y + this.ai.moodElevation - PetCharacter.nameGap);

        //Keep the name on canvas (bottom baseline -> the text extends one font size above y)
        const y = Math.max(yAnchor, PetCharacter.nameFontSize);

        //Draw text with an outline so it reads on any background
        ctx.save();
        ctx.font = `${PetCharacter.nameFontSize}px Stardew`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#2b1b10';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        ctx.restore();
    }
```

The early return matters: `GameObject.isPosInSprite` re-runs `draw` on a scratch canvas to decide whether a click hit an opaque pixel, and it passes `options.pos`. Text must not take part in that.

- [x] **Step 4: Make sure the font is loaded before the first frame**

Canvas text does not trigger font loading the way DOM text does, so the first frames can render in a fallback font. In `src/game/engine.ts`, in `Game.start`, directly after the three `getContext` lines, add:

```ts
        //Preload the pet name font (canvas text does not trigger font loading on its own)
        document.fonts.load('8px Stardew').catch(() => {});
```

- [x] **Step 5: Typecheck**

Run: `npm run compile`
Expected: no output, exit code 0.

- [ ] **Step 6: Look at it**

Press <kbd>F5</kbd> and open the farm with two or three pets.

Expected: each pet carries its name in white with a dark outline, sitting just above the sprite and moving with it.

Check all three values of `stardew-pets.scale` (Small, Medium, Big). The text is drawn in game units and magnified by the same CSS transform as the sprites, so it should grow with them and stay crisp-edged. If the text is illegible at Small, change `nameFontSize` to `7` or `9` and rebuild — do not reach for a DOM overlay, that path is closed by ADR-0001.

Note: a pet that walks to the very top of the farm gets its name pushed down onto its own sprite, because the clamp floors the baseline rather than letting the text run off the canvas. The project owner looked at this and chose to keep it, rather than flip the name below the pet when it runs out of room above.

- [x] **Step 7: Commit**

```bash
git add src/game/entities/pets.ts src/game/engine.ts
git commit -m "feat: draw pet names above pets"
```

---

### Task 2: Shorten long Names

**Files:**
- Modify: `src/game/util.ts:175-179` (add `truncate` next to `titleCase`)
- Modify: `src/game/entities/pets.ts` (use it in `#drawName`)

**Interfaces:**
- Consumes: `PetCharacter.#drawName` from Task 1.
- Produces: `Util.truncate(text: string, max: number): string`, `PetCharacter.nameMaxChars: number`.

- [x] **Step 1: Add the helper**

Twitch display names run to 25 characters, which is wider than any pet and wide enough to cover its neighbours. In `src/game/util.ts`, inside `class Util`, directly below `titleCase`, add:

```ts
    static truncate(text: string, max: number) {
        //Short enough -> Leave it alone
        if (text.length <= max) return text;

        //Too long -> Cut it and mark the cut (the pixel font has no … glyph)
        return `${text.substring(0, max - 2)}..`;
    }
```

- [x] **Step 2: Add the limit constant**

In `src/game/entities/pets.ts`, in `class PetCharacter`, extend the constants added in Task 1 so the block reads:

```ts
    //Name plate
    static nameFontSize: number = 8;
    static nameGap: number = 2;
    static nameMaxChars: number = 12;
```

- [x] **Step 3: Use it**

In `#drawName`, replace:

```ts
        const text = this.name;
```

with:

```ts
        const text = Util.truncate(this.name, PetCharacter.nameMaxChars);
```

`Util` is already imported in this file.

- [x] **Step 4: Typecheck**

Run: `npm run compile`
Expected: no output, exit code 0.

- [ ] **Step 5: Look at it**

Press <kbd>F5</kbd>, run `Add pet`, and give the pet the name `Verylongstreamer`.

Expected: the Nameplate reads `Verylongst..` — ten characters and two dots.

- [x] **Step 6: Commit**

```bash
git add src/game/util.ts src/game/entities/pets.ts
git commit -m "feat: truncate long pet names on the nameplate"
```

---

### Task 3: Lift the emote above the Nameplate — DROPPED

**Do not implement this task.** It was written on a false premise and dropped after review; it is kept here so the numbering in the ledger and the commit history still lines up.

The premise was that the emote and the Nameplate collide. They do not. `ctx.drawImage` anchors the emote by its top edge while the Nameplate is drawn with `textBaseline = 'bottom'`, so with the anchor at `e = pos.y + moodElevation`, the name occupies `[e - 10, e - 2]` and the emote `[e, e + 9]` — the emote sits on the pet's head and the name floats above it, already clear.

The original fix shifted the emote up by exactly the Nameplate's height, which moved it onto the name and made it paint over the text — the opposite of the intent. Rather than shift by the name's height plus the emote's own, the project owner chose to leave the emote where it has always been.

Consequence carried into Task 1 and Task 4: `#drawName` returns nothing, because nothing consumes a height any more.

---

### Task 4: The `showNames` setting

**Files:**
- Modify: `package.json:51-83` (the `contributes.configuration.properties` block)
- Modify: `src/extension.ts:143-176` (`initGame`), `src/extension.ts:360-387` (the configuration watcher)
- Modify: `src/game/main.ts:204-249` (the message switch)
- Modify: `src/game/engine.ts:647-660` (`Game` window block)
- Modify: `src/game/entities/pets.ts` (`#drawName` early return)
- Modify: `README.md` (the settings list)

**Interfaces:**
- Consumes: `PetCharacter.#drawName` from Task 1.
- Produces: `Game.showNames: boolean`, `Game.setShowNames(showNames: boolean): void`, and a `shownames` webview message carrying `{ type: 'shownames', value: boolean }`.

- [x] **Step 1: Declare the setting**

In `package.json`, inside `contributes.configuration.properties`, after the `stardew-pets.monsters` block, add a comma and:

```json
                "stardew-pets.showNames": {
                    "type": "boolean",
                    "default": true,
                    "description": "Shows each pet's name above it."
                }
```

- [x] **Step 2: Send it when the farm loads**

In `src/extension.ts`, in `initGame`, after the monsters toggle block and before the money block, add:

```ts
    //Send names toggle
    webview.postMessage({
        type: 'shownames',
        value: config.get('showNames')
    });
```

- [x] **Step 3: Send it when it changes**

In `src/extension.ts`, in the `vscode.workspace.onDidChangeConfiguration` callback, after the monsters block, add:

```ts
        //Names toggle changed
        if (event.affectsConfiguration("stardew-pets.showNames")) {
            webview.postMessage({
                type: 'shownames',
                value: config.get('showNames')
            })
        }
```

- [x] **Step 4: Hold the flag in the game**

In `src/game/engine.ts`, in `class Game`, directly after the `setScale` arrow function, add:

```ts
    //Pet names
    static #showNames: boolean = true;

    static get showNames(): boolean { return this.#showNames; }

    static setShowNames = (showNames: boolean) => {
        //Update names toggle
        this.#showNames = showNames;
    }
```

- [x] **Step 5: Receive the message**

In `src/game/main.ts`, in the `switch (message.type.toLowerCase())` block, after the `monsters` case, add:

```ts
        //Update names toggle
        case 'shownames':
            Game.setShowNames(message.value === true);
            break;
```

The switch lowercases the type, which is why the case is `shownames` and not `showNames`.

- [x] **Step 6: Honour the flag**

In `src/game/entities/pets.ts`, make `#drawName` bail out first. Its opening becomes:

```ts
    #drawName(ctx: CanvasRenderingContext2D) {
        //Names are hidden
        if (!Game.showNames) return;

        //Get text & position
        const text = Util.truncate(this.name, PetCharacter.nameMaxChars);
```

- [x] **Step 7: Document it**

`README.md` has no list of settings; each feature mentions its own in prose, the way the Monsters section says "You can disable monsters in settings if you don't want them to appear." Follow that. In the `## Pets` section, replace:

```markdown
You can have pets with custom names to keep you company while coding.  
```

with:

```markdown
You can have pets with custom names to keep you company while coding.  
Each pet's name is shown above it, and you can hide the names in settings.  
```

Keep the two trailing spaces: this file uses them for line breaks.

- [x] **Step 8: Typecheck**

Run: `npm run compile`
Expected: no output, exit code 0.

- [ ] **Step 9: Look at it**

Press <kbd>F5</kbd>, then in the Extension Development Host open `Stardew Pets Settings` from the view's title bar.

Expected: **Show names** is present and checked, names are visible. Uncheck it: every Nameplate disappears immediately, with no reload. Check it again: they come back. The mood emotes do not move either way — Task 3, which would have moved them, was dropped.

Then close and reopen the farm view with the setting off, and confirm the names stay off — that proves Step 2 wired `initGame`, not just the watcher.

- [x] **Step 10: Commit**

```bash
git add package.json src/extension.ts src/game/main.ts src/game/engine.ts src/game/entities/pets.ts README.md
git commit -m "feat: add showNames setting for pet nameplates"
```
