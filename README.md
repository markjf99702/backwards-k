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
  <img src="docs/phone-card.png" alt="The Comets' scorecard from a finished game: a grid of batters and innings, each box with a small diamond, the path around the bases, and marks like F8, 4-3 and a backwards K" width="250">
</p>

## How it works

- **Tap what happened.** Ball, Strike or Foul if you're counting pitches (four balls or three strikes finish the
  at-bat by themselves), then what the batter did: a hit, a walk, an error, a strikeout swinging or looking, a ground
  out, a fly out and the rest. Counting pitches is optional; you can tap only the results.
- **Runners move themselves.** With runners on, you see where everyone usually ends up and change whatever went
  differently. Tap a runner on the field for a steal, a wild pitch, a pickoff or a balk.
- **Tap the field for the fielders.** For a ground out, tap the shortstop and then the first baseman, and the card
  says 6-3. Or skip it.
- **The scorecard fills itself in.** Each box has the path around the bases, the out number, the count and the RBIs,
  and a strikeout looking gets its backwards K. Tap any box to read what happened, or to fix it.
- **Undo anything.** A game is a list of what happened, so Undo takes the last thing back, as many times as you like.
- **It knows when the game is over.** Final comes when the last inning is decided, or the moment the home team goes
  ahead in it. **Keep playing** after a Final finishes that half-inning; a game you ended early (rain, a mercy rule)
  picks up where it stopped and ends the usual way.
- **Phone or tablet.** On a phone the buttons, the card, the box score and the play-by-play are tabs. On a tablet the
  buttons and the card sit side by side, and the card fills in while you watch.
- **Lineups when you want them.** Start with two team names, and name batters as they come up, paste a lineup, or
  reuse a team from an earlier game. Pinch hitters, pinch runners and pitching changes are a tap on the batter or the
  pitcher.
- **Sharing.** Send a link that carries the whole game (nothing is uploaded to share it), copy the score as text for
  a group chat, print both cards, or save the game as a file.
- **Google Drive, if you like.** Each game is saved as its own file in a "Backwards K" folder in your Drive, and shows
  up on every phone, tablet and computer where you turn it on.
- No account and no server. Games are saved in your browser. It works offline, keeps the screen awake during a game,
  and installs to a phone's or tablet's home screen.

### What's saved where

- **On each device:** every game, in the browser's storage. If the browser won't save (private browsing, site data
  turned off, or a device that's out of room), the game screen says so and offers to save the game as a file.
- **In Google Drive, when it's on:** one JSON file per game in the "Backwards K" folder, with a line or two at the top
  saying who played and the score. Whichever copy of a game changed last wins. A deleted game's file goes to Drive's
  bin, and the game is deleted on your other devices too. With no signal, games wait on the device and go up when
  it's back.
- Backwards K can only see the files it made. Signing in lasts an hour and stays on that device. To take the
  permission back, remove junkdrawer.works under **Third-party apps & services** in your Google Account; "Stop saving
  on this device" only stops this device.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npx serve .                   # or any static file server, then open the printed address
npm test                      # the rules, a game played in Chromium, and Drive saving against a pretend Google
node tools/screenshots.mjs    # redraws docs/*.png and og.png
node tools/make-icons.mjs     # redraws the PNG icons from icon.svg
npm run build                 # dist/backwards-k.html: the whole app in one file
```

To put it online with GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick
`main` and `/ (root)`. The `CNAME` file gives it its own address, backwards-k.junkdrawer.works.

### Files

- `js/engine.js`: the rules. It replays a game's list of events into the count, outs, runners, score, the boxes on the
  scorecard, the stats and the play-by-play.
- `js/model.js`: what a saved game looks like, and tidying one that came from a file, a link or Drive.
- `js/store.js`: games in the browser's storage.
- `js/game.js`: the game screen: the buttons, the runner and fielder sheets, lineups, substitutions and undo.
- `js/card.js`: the scorecard and the line score. `js/box.js`: the box score and the play-by-play.
- `js/field.js`: the field drawings. `js/help.js`: how to read the card.
- `js/home.js`, `js/setup.js`: the first screen, and starting a game.
- `js/share.js`: share links, the score as text, printing. `js/sync.js`: Google Drive.
- `js/sample.js`: a made-up game played with seeded dice, for the sample, the pictures and the tests.
- `fonts/`: Big Shoulders, Source Sans 3 and Patrick Hand (SIL Open Font License), served from here so nothing loads
  from elsewhere.
- `sw.js`: keeps a copy for using offline.
- `test/unit.test.mjs`: the rules, including 300 simulated games whose totals have to agree. `test/e2e.mjs`: a game
  scored in Chromium. `test/drive.mjs`: two devices sharing one pretend Drive (`test/fake-google.mjs`).
- `scripts/build.mjs`: the one-file copy.
