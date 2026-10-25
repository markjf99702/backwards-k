# Backwards K

**Use it: [backwards-k.junkdrawer.works](https://backwards-k.junkdrawer.works/)**

**Keep score at a baseball or softball game on your phone or tablet.** Tap what happened (Ball, Strike, Single,
Ground out 6-3) and Backwards K moves the runners, keeps the count, the outs, the score and each pitcher's pitch
count, and fills in a classic paper scorecard as you go. You don't need to know the shorthand: every play is also
written out in plain words.

<p align="center">
  <img src="docs/phone-score.png" alt="The scoring screen in the top of the 7th: Foxes 1, Comets 3, a 1-2 count, runners on first and second, and buttons for Ball, Strike, Foul and every kind of hit and out" width="250">
  &nbsp;
  <img src="docs/phone-runners.png" alt="After a single with two on: a sheet showing where each runner and the batter ended up, with the usual moves already picked" width="250">
  &nbsp;
  <img src="docs/phone-card.png" alt="The Comets' scorecard from a finished game, under the line score with R, H and E: a grid of batters and innings, each box with a small diamond, the path around the bases, and marks like F8, 4-3 and K" width="250">
</p>

## How it works

- **Tap what happened.** Ball, Strike or Foul if you're counting pitches (four balls or three strikes finish the
  at-bat by themselves), then what the batter did: a hit, a walk, an error, a strikeout swinging or looking, a ground
  out, a fly out and the rest. Counting pitches is optional; you can tap only the results.
- **Runners move themselves.** With runners on, you see where everyone usually ends up and change whatever went
  differently. Tap a runner on the field for a steal, a wild pitch, a pickoff or a balk; everyone who moved up on
  the same wild pitch or throw goes in as one play.
- **Tap the field for the fielders.** For a ground out, tap the shortstop and then the first baseman, and the card
  says 6-3. Or skip it. On a keyboard, type their numbers and press Enter.
- **The scorecard fills itself in.** Each box has the path around the bases, the out number, the count and the RBIs,
  and a strikeout looking gets its backwards K. Tap any box to read what happened. A box can also be switched to
  another kind of out or another way of reaching base, and have its fielders changed; anything else is a job for
  Undo, or for Fix runners, which stays until the next batter's turn is over.
- **Undo anything.** A game is a list of what happened, so Undo takes plays back, latest first, as many as you like.
  It's at the top of the screen, and under the field beside the play it would take back, and it says which one it
  took (with Redo) when the line under the field is out of sight. A change made in a box has its own Undo, right
  after it.
- **It knows when the game is over.** Final comes when the last inning is decided, or the moment the home team goes
  ahead in it. That run is the last to count, and a hit that brings it in counts for the bases it needed, as an
  official scorer has it: with the bases loaded, a double that wins the game is a single (a home run still scores
  everyone). **Keep playing** after a Final finishes that half-inning; a game you ended early (rain, a mercy rule)
  picks up where it stopped and ends the usual way.
- **Phone or tablet.** On a phone the buttons, the card, the box score and the play-by-play are tabs. On a tablet
  held sideways (or any screen 1000 pixels wide or more) the buttons and the card sit side by side, and the card
  fills in while you watch; on one held upright, the card is under the buttons.
  <p align="center"><img src="docs/tablet.png" alt="A tablet on its side in the top of the 7th: the field with runners on first and second and a 1-2 count, the pitch and result buttons under it, and beside them the line score and the Foxes' scorecard filling in, with Brennan's box outlined in red while he bats" width="600"></p>
- **Lineups when you want them.** Start with two team names, and name batters as they come up, paste a lineup (from a
  group text or a game preview, starting pitcher included), or reuse a team from an earlier game (its starters, in the
  same spots). Pinch hitters and pitching changes are a tap on the batter or the pitcher (a reliever already in the
  batting order is one more tap, with no typing), and a pinch runner is a tap on the runner. A starter who comes back
  in (or the runner who ran for him) goes back in as the same player, with one line in the box score.
- **Sharing.** Send a link that carries the whole game (nothing is uploaded to share it), copy the score as text for
  a group chat, print both cards and the box score (a page each, Letter or A4, upright or sideways), or save the
  game as a file.
- **Google Drive, if you like.** Each game is saved as its own file in a "Backwards K" folder in your Drive, and shows
  up on every phone, tablet and computer where you turn it on.
- No account and no server. Games are saved in your browser. It works offline (and on one bar of signal, when the
  network is slow to answer), keeps the screen awake during a game, and installs to a phone's or tablet's home screen.

### What's saved where

- **On each device:** every game, in the browser's storage. If the browser won't save (private browsing, site data
  turned off, or a device that's out of room), the game screen says so and offers to save the game as a file. Games
  stored but unreadable (damaged) are put aside in the browser's storage, under backwards-k.v1.unreadable-…, rather
  than written over.
- **In Google Drive, when it's on:** one JSON file per game in the "Backwards K" folder, with a line or two at the top
  saying who played and the score. A game changed on one device is brought up to date on the others. One changed on
  two devices before they caught up is put together by its plays: when one copy's plays are the start of the other's,
  it gets the rest, with the names and settings changed last (and a play taken back with Undo stays taken back), and
  when each copy has plays the other lacks, both are kept, and the one from the device that finds it is marked
  "(second copy)". Saving a shared link to a game you already have works the same way. A deleted game's file goes to
  Drive's bin, and the game is deleted on your other devices too. With no signal, games wait on the device and go up
  when it's back.
- Backwards K can only see the files it made. Signing in lasts an hour and stays on that device. To take the
  permission back, remove junkdrawer.works under **Third-party apps & services** in your Google Account; "Stop saving
  on this device" only stops this device.
- **A game saved by a newer Backwards K** (on another device, or from a file or a link) opens look-only here until a
  reload brings that version, and whatever this copy doesn't know is kept as it came.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npm start                     # serves it at http://localhost:9600 (any static file server will do)
npm test                      # the rules, a game played in Chromium, and Drive saving against a pretend Google
node tools/screenshots.mjs    # redraws docs/*.png and og.png
node tools/make-icons.mjs     # redraws the PNG icons from icon.svg
npm run build                 # dist/backwards-k.html: the whole app in one file
```

To put it online with GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick
`main` and `/ (root)`. The `CNAME` file gives it its own address, backwards-k.junkdrawer.works.

### Files

- `js/app.js`: which screen the address shows: your games, a new game, a game, the sample, or a shared link.
- `js/engine.js`: the rules. It replays a game's list of events into the count, outs, runners, score, the boxes on the
  scorecard, the stats and the play-by-play.
- `js/model.js`: what a saved game looks like, tidying one that came from a file, a link or Drive, reading a pasted
  lineup, and what Undo takes back with an event.
- `js/store.js`: games in the browser's storage.
- `js/game.js`: the game screen: the buttons, the runner and fielder sheets, lineups, substitutions and undo.
- `js/card.js`: the scorecard and the line score. `js/box.js`: the box score, the play-by-play and a batter's day.
- `js/field.js`: the field drawings. `js/help.js`: how to read the card.
- `js/home.js`, `js/setup.js`: the first screen, and starting a game.
- `js/share.js`: share links, the score as text, printing. `js/sync.js`: Google Drive.
- `js/sample.js`: a made-up game played with seeded dice, for the sample, the pictures and the tests.
- `js/ui.js`: the sheet, the toast, saving and opening files, and the other small helpers every screen uses.
- `fonts/`: Big Shoulders, Source Sans 3 and Patrick Hand (SIL Open Font License), served from here so nothing loads
  from elsewhere.
- `sw.js`: keeps a copy for using offline, and for when the network is slow to answer (more than three seconds, or a
  second and a half for a file it does send). The copy is always one whole version of the app, and a page gets one
  version, the network's or the copy's, never some files of each. A little script in `index.html` reloads a page
  that didn't start (which a copy kept by an older `sw.js` could cause).
- `test/unit.test.mjs`: the rules, including 300 simulated games whose totals have to agree. `test/e2e.mjs`: a game
  scored in Chromium, and the offline copy on one bar of signal, with today's `sw.js` and the one before it
  (`test/sw-before.js`). `test/drive.mjs`: two devices sharing one pretend Drive (`test/fake-google.mjs`).
- `tools/screenshots.mjs`: the pictures in this README and the link preview, `og.png`, drawn from the sample game.
  `tools/make-icons.mjs`: the PNG icons, from `icon.svg`, and from `tools/icon-full-bleed.svg` (for iPhones, which
  round the corners themselves) and `tools/icon-maskable.svg` (for Android, which crops to a circle).
- `scripts/build.mjs`: the one-file copy, `dist/backwards-k.html`, and `dist/artifact.html`, the same page without
  its own `<html>`, `<head>` and `<body>`, for hosts that supply them. `dist/` isn't committed.
