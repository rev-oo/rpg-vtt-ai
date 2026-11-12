# Study: Interface review (T-1606)

This review looks at every screen of the web app before the 1.0 freeze, on desktop and on a phone. For each screen it checks the layout, consistency, empty states, feedback, and use by keyboard and screen reader. It ends with proposed tasks; the ones the user picks join M16.

## How it was done

- **Screenshots.** `e2e/scripts/capture-screens.mjs` starts from a fresh server and sets up a table the way a group would use it:
  - an admin GM and a player;
  - the `srd5` and `tiny-d20` systems, with `dice-3d` installed but not enabled;
  - two tables;
  - a character with two conditions on, two creatures, gear, a spell and two journal entries;
  - two scenes, with three tokens on the shown one;
  - a running encounter, and chat with an attack card, a roll and messages.

  The script then captures each screen at 1440 × 900 (desktop) and 390 × 844 (phone, touch), in English, plus the tables list and the table in the dark theme. All 62 images are in [`interface-review/`](interface-review/). The script can be run again after the fixes; how is at the top of the file.

- **Keyboard.** A second pass pressed Tab through the tables page and the table, recording where focus went and whether each stop showed a focus ring.
- **Screen readers.** It also read the table page's accessibility tree: its landmarks, headings and regions.
- **Limits.** There was no automatic accessibility checker (axe is not a dependency) and no real screen reader, and only Chromium was used.

## Summary

The app works on both sizes, and the basics are sound:

- forms are labelled, and icon buttons have names and tooltips;
- panels are labelled regions, and chat is a live log;
- the token list mirrors the map for screen readers.

These are the most important problems:

1. **There is no way to add users in the app** (R1). By default only admins can create accounts, but no page lets them do it. A new instance cannot let its players in without calling the API.
2. **The character sheet hides its Hit Points on desktop** (R9). Counters in narrow grid columns shrink their value to nothing.
3. **Chat shows roll formulas in their internal syntax** (R10), for example `(@let.edge == 0 ? 1d20 : …) + @actions[@args.id].bonus …`. Players see it too.
4. **On the map, token names are hard to read**, and in the dark theme the grid all but disappears (R11, R12).
5. **Narrow panels truncate the very names you look for**, such as journal titles, combatants and members (R13). Lists show type ids such as `npc` instead of the system's labels (R16).
6. **The table on a phone is a desktop layout made smaller** (R5, R14, R18).
7. **Keyboard use:** focus on panel tabs is invisible, and reaching chat from the top takes over 60 presses of Tab (R22, R23).

## Findings

Each finding has a severity:

- **High:** blocks a task, or hides information.
- **Medium:** slows people down or confuses them.
- **Low:** polish.

### Signing in and the app pages

#### R1. Admins cannot add, list or reset users (High)

- **Today:**
  - The instance setting "Who can create accounts" defaults to **Only admins**.
  - The **Instance** page holds only settings. No page lists users, creates one with a one-time password, or resets a password; this is possible only through `POST /users`.
  - The other choice, "Admins, and anyone with a table invite link", lets players sign up from an invite. An admin still cannot see or manage the accounts.
- **Screenshot:** [instance settings](interface-review/07-admin-settings-desktop.jpg).
- **Proposal:** a **Users** page for admins:
  - lists the users;
  - creates a user and shows the one-time password;
  - resets a user's password;
  - disables a user.

#### R2. Unknown addresses quietly show the tables list (Low)

- **Today:** `routes/catch-all.tsx` redirects any unknown path to `/`, so a mistyped or old link lands on **Your tables** with no message ([screenshot](interface-review/08-not-found-desktop.jpg)).
- **Proposal:** a "Page not found" page with a link back.

#### R3. The invite page does not say what you are invited to (Low)

- **Today:** someone signed out sees "Table invitation. Sign in to accept this invitation." and a plain **Sign in** link styled as text ([phone](interface-review/09-invite-phone.jpg)). It names neither the table nor its GM.
- **Proposal:** name the table and its GM, and make **Sign in** a button.

#### R4. Login and setup (Low)

- **Today:** both are clear and well spaced at both sizes ([setup](interface-review/01-setup-desktop.jpg), [login error on a phone](interface-review/02-login-error-phone.jpg)). The only issue is the generic site name "VTT", which the admin can change.
- **Proposal:** nothing, unless a product name is chosen.

#### R5. The header takes three rows on a phone (Medium)

- **Today:** the links wrap under the site name, and **Log out** takes a row of its own, so about 150 px go before any content ([phone](interface-review/03-tables-phone.jpg)). "Signed in as …" is hidden on phones.
- **Proposal:** on narrow screens, put the links and Log out in one menu button.

#### R6. Version numbers appear where people play (Low)

- **Today:** table cards show "SRD 5.2 (fifth edition) 0.1.0" to every member, and so does the table's header ("GM · SRD 5.2 (fifth edition) 0.1.0") ([tables](interface-review/03-tables-desktop.jpg)). The empty state is a single line of text ([empty](interface-review/03-tables-empty-desktop.jpg)).
- **Proposal:** keep the version on the Settings and Plugins pages; cards and the header show the system's name.

#### R7. Plugins page (Low)

- **Today:**
  - The issue count reads "1 errors, 0 warnings".
  - On a phone, the **Enable** button sits between the plugin's id line and its badges ([phone](interface-review/06-admin-plugins-phone.jpg)).
  - The list has no filter. With the fixture plugins of this instance, it runs to many screens.
- **Proposal:** a plural form for the count, and **Enable** after the badges on narrow screens. A filter can wait.

#### R8. Primary buttons are used unevenly (Low)

- **Today:**
  - On **Account**, **Save** has the outlined style, while **Change password** below it is filled ([account](interface-review/05-account-desktop.jpg)).
  - Table **Settings** has two filled save buttons. **Save modules** shows even when "No modules are enabled on this server" ([settings](interface-review/11-panel-settings-desktop.jpg)).
- **Proposal:** one filled button per form, and no save button for an empty section.

### The table

#### R9. Sheet counters lose their value in narrow columns (High)

- **Today:** on the desktop layout, the srd5 character sheet sits between the side panels. There:
  - **Hit Points** and **Temporary Hit Points** shrink their number field to a sliver between − and +, so the 21 HP do not show;
  - the label "Hit Point maximum" overflows onto the field below;
  - "Heroic Inspiration" is cut off ([character sheet](interface-review/12-sheet-character-desktop.jpg)).

  The creature sheet has the same problem ([creature](interface-review/12-sheet-npc-desktop.jpg)). On a phone, the fields stack and show fine ([phone](interface-review/12-sheet-character-phone.jpg)).

- **Proposal:** fix this in `sheet-renderer`, for every system:
  - a counter keeps a minimum width for its value;
  - a grid wraps to fewer columns when its cells are narrower than that;
  - long labels wrap without overlapping the field.

#### R10. Chat shows roll formulas in their internal syntax (High)

- **Today:** a roll line shows the recipe's formula, then "→", then the resolved formula, so the internals leak:
  - the goblin's attack shows `(@let.edge == 0 ? 1d20 : @let.edge > 0 ? 2d20kh1 : 2d20kl1) + @actions[@args.id].bonus - @derived.d20Penalty + roll(@options.bonus) → 1d20 + 4`;
  - every initiative roll shows `1d20 + @derived.initiative → 1d20`.

  Players see the same lines ([player](interface-review/14-table-player-desktop.jpg), [chat on a phone](interface-review/11-panel-chat-phone.jpg)). Even a plain `/r 1d20+5` takes three lines: the formula, the dice, then the total.

- **Proposal:**
  - show the resolved formula (`1d20 + 4`), then the dice and the total;
  - show the recipe's formula only on request, such as in a "Formula" disclosure.

#### R11. Token names and statuses are hard to read on the map (Medium)

- **Today:**
  - **Light theme:** token names are drawn with a thick dark outline that blurs the letters ("Mira Ashdown" and "Goblin Warrior" in [the map](interface-review/10-table-gm-desktop.jpg)).
  - **Phone:** at the fitted zoom, names are unreadable ([phone](interface-review/10-table-gm-phone.jpg)).
  - **Status icons** are about 10 px across on the token.
  - The token list below the map is legible, and it carries the same names and statuses.
- **Proposal:**
  - draw names on a solid pill, as in the dark theme, which reads well ([dark](interface-review/15-dark-table-desktop.jpg));
  - give status icons a minimum size on screen;
  - hide names below a zoom level where they cannot be read.

#### R12. The dark theme hides the grid and the status icons (Medium)

- **Today:** in the dark theme:
  - the map grid lines all but disappear;
  - srd5's status icons, a white glyph on a dark disc, lose their disc against the dark background, in the tracker and in the token list ([dark](interface-review/15-dark-table-desktop.jpg)).
- **Proposal:** a grid colour taken from the theme, and a light ring around status icons in the dark theme.

#### R13. Narrow panels truncate the names you look for (Medium)

Rows put their controls on the same line as the name, so in a side column the name is what gives way:

- **Journal:** titles show as "Sessi…" and "The A…", next to **Open** and three icon buttons. "Hidden from players · You can edit" wraps one word per line ([journal](interface-review/13-journal-entry-desktop.jpg)).
- **Combat:** "Mir…" and "Goblin W…" sit beside the initiative number, an initiative field showing the same number again, **Hide** and ×. On a phone it is "Mira…" ([desktop](interface-review/10-table-gm-desktop.jpg), [phone](interface-review/11-panel-combat-phone.jpg)).
- **Members:** your own row shows "An…", beside the role, default character, roll options and **Leave table** ([members](interface-review/11-panel-members-desktop.jpg)).

**Proposal:** in narrow panels, rows put their controls below the name. Combat shows the initiative once, as a field the GM can edit.

#### R14. Panel tabs cut and hide each other (Medium)

- **Today:**
  - **Desktop:** with three panels in a group, tabs are cut mid-word ("Journa"), and the others hide behind a "⌄ 4" menu ([desktop](interface-review/10-table-gm-desktop.jpg)).
  - **Phone:** every panel is a tab in one strip, 8 to 12 of them, with most behind the overflow menu ([phone](interface-review/10-table-gm-phone.jpg)). The **Panels** menu is the reliable way to switch.
- **Proposal:**
  - on desktop, shorten tabs to their icons when space runs out instead of cutting words;
  - on phones, use a bottom bar with the main panels (Map, Sheet, Chat, Combat) and **More** for the rest.

#### R15. The combat tracker's controls (Medium)

- **Today:**
  - **End encounter** is a text button beside **Previous turn** and **Next turn**, and it ends the encounter at once, without asking (`CombatTracker.tsx`).
  - At the default panel height, the add-combatant form is cut off below the list ([combat](interface-review/10-table-gm-desktop.jpg)).
- **Proposal:**
  - **End encounter** asks first, and moves away from the turn buttons;
  - adding a combatant goes behind an **Add** button.

#### R16. Lists show type ids instead of the system's labels (Low)

- **Today:** actor, item and compendium rows read "Type: npc", "Type: character" and "Type: gear". The system already labels its types: srd5's `npc` type has the label `type.npc`, "Creature" ([actors](interface-review/11-panel-actors-desktop.jpg), [items](interface-review/11-panel-items-desktop.jpg), [compendium](interface-review/11-panel-compendium-desktop.jpg)). The type filters show raw ids too.
- **Proposal:** rows and filters use the translated type label.

#### R17. The Table page has little on it (Low)

- **Today:** it shows the description and a hint about panels ([overview](interface-review/11-panel-overview-desktop.jpg)).
- **Proposal:** it can show the members and who is online, the shown scene and the encounter. Optional.

#### R18. A phone shows desktop hints and splits rolling from its result (Medium)

- **Today:** on a phone:
  - the map says "Or drag an actor from Actors onto the map", which cannot be done there;
  - the Dice panel and Chat are separate tabs, so a roll's result shows in another tab ([dice](interface-review/11-panel-dice-phone.jpg));
  - the fitted map leaves much of the screen empty ([player](interface-review/14-table-player-phone.jpg)).
- **Proposal:**
  - hide drag hints on touch screens;
  - show a roll's result where it was rolled, as a short notice;
  - fit the map to the panel's width.

#### R19. Giving an item picks an actor for you (Low)

- **Today:** each item row has a **Give** button with an actor list that starts on the first actor ("Goblin Warrior"), so one click gives the item to whoever is first. The delete button sits alone on its own row ([items](interface-review/11-panel-items-desktop.jpg)).
- **Proposal:** the list starts on "Choose an actor", and **Give** waits for a choice.

#### R20. Invite links cannot be told apart or copied later (Low)

- **Today:** every link in the list reads "Player · Active · expires 11/19/2026, 8:47:33 AM". A link can be copied only right after it is created; the list has no **Copy** ([members](interface-review/11-panel-members-desktop.jpg)).
- **Proposal:** show when each link was made and how often it was used, add **Copy** to each row, and drop the seconds.

#### R21. Some actions do not look like buttons (Low)

- **Today:**
  - On a card, **Roll damage** looks like a heading ([chat on a phone](interface-review/11-panel-chat-phone.jpg)).
  - **End encounter** and the sheet's **Choose image** and **History** have no outline, unlike the buttons around them ([sheet](interface-review/12-sheet-character-desktop.jpg)).
- **Proposal:** one button style for actions in cards and panels.

### Keyboard and screen readers

#### R22. Panel tabs show no focus ring (Medium)

- **Today:** pressing Tab moves focus to each group's active tab ("Actors", "Map", "Combat"), but nothing marks it. Every other stop on both pages showed an outline.
- **Proposal:** dock tabs get the app's focus ring.

#### R23. No quick way between panels (Medium)

- **Today:**
  - From the header, Tab goes through every row of the Actors list (four stops per actor), the map's tools and the whole tracker before it reaches Chat: more than 60 stops with three actors.
  - The page has a `banner` and a labelled region per panel, but no `main` landmark, no skip links and no shortcut between panels.
- **Proposal:**
  - F6 and Shift+F6 move focus to the next or previous panel group, as in desktop apps;
  - a "Skip to panel" menu at the top;
  - a `main` landmark around the dock.

#### What already works

- Fields have visible labels.
- Icon buttons have names and tooltips: Duplicate, Ownership, Delete, and the map's Select, Ruler, Circle and Cone.
- Chat is a `log`, and each panel a named region.
- The token list gives screen readers every token's position and statuses.

## Proposed tasks

Pick the ones to add to M16. Each one lists the findings it closes.

| #   | Task                                                                                                                                                                                                                                                | Findings                     | Size   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------ |
| P1  | **Users page for admins:** list, create with a one-time password, reset a password, disable.                                                                                                                                                        | R1                           | Medium |
| P2  | **Sheet grids fit their fields:** counters keep their value visible, grids wrap to fewer columns, labels wrap cleanly.                                                                                                                              | R9                           | Small  |
| P3  | **Readable roll lines:** the resolved formula, then the dice and the total; the recipe's formula on request.                                                                                                                                        | R10                          | Small  |
| P4  | **Map legibility:** names on a pill, status icons of a minimum size, a theme-aware grid, a ring around status icons in the dark theme.                                                                                                              | R11, R12                     | Small  |
| P5  | **Narrow panels:** controls below names in journal, combat and member rows; initiative shown once; translated type labels; **Give** without a preset actor.                                                                                         | R13, R16, R19                | Medium |
| P6  | **The table on a phone:** a menu header, a bottom bar for the main panels, roll results where you roll, no drag hints on touch, the map fitted to the width.                                                                                        | R5, R14, R18                 | Large  |
| P7  | **Keyboard:** a focus ring on panel tabs, F6 between panel groups, skip links, a `main` landmark.                                                                                                                                                   | R22, R23                     | Small  |
| P8  | **Small fixes:** a not-found page, an invite page that names the table, the plural count, asking before ending an encounter, copying invites from the list, one filled button per form, versions out of the play screens, consistent button styles. | R2, R3, R6–R8, R15, R20, R21 | Medium |
| P9  | **A fuller Table page:** members and who is online, the shown scene, the encounter. Optional.                                                                                                                                                       | R17                          | Small  |

## Questions

- **Q1.** Should the phone become a first-class way to play (P6), or stay a way to follow a game and check one's sheet? P6 is the largest task here, and the answer sets how far it goes.
- **Q2.** Should the capture script stay in the repo to repeat this review after the fixes? It is included, under `e2e/scripts/`.
