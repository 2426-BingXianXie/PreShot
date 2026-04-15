# PreShot

A Chinese 8-ball billiards game with real-time cue-ball trajectory prediction. Built with React, TypeScript, and Canvas rendering. The app provides a playable game loop with spin control, ghost-ball aiming, and a practice mode for shot rehearsal.

## Features

- **Chinese 8-ball gameplay**: full match loop with solids/stripes group assignment, foul detection, turn switching, ball-in-hand, and 8-ball win/loss conditions.
- **Free aim with ghost-ball aiming**: mouse position on the table defines aim direction; the first object ball within the 2R envelope is auto-detected as the target.
- **Trajectory preview**: real-time dotted-line visualization of:
  - Pre-contact cue ball path to ghost ball position.
  - Object ball deflection path.
  - Post-contact cue ball path to predicted stop position (modified by spin).
- **Spin control**: adjustable cue hit point (side, top/back) with a zoomable hit-point editor.
- **Power stick**: pull-down-and-release mechanic for shot execution; power resets to zero after each shot.
- **Practice mode**: drag balls to any position, save/load custom layouts, and redo/rollback shots.
- **Match mode**: local hotseat (2 players) and local vs AI with selectable style (attack / balanced / safety).
- **Event feed**: timestamped log of pots, fouls, ball-in-hand, and game results.

## Getting started

```bash
cd web
npm install
npm run dev
```

Open the URL printed in the terminal (default `http://localhost:5173`).

## Scripts

All commands run from the `web/` directory.

| Command          | Description                        |
| ---------------- | ---------------------------------- |
| `npm run dev`    | Start Vite dev server              |
| `npm run build`  | Type-check and build for production|
| `npm run test`   | Run Vitest test suite              |
| `npm run lint`   | Run ESLint                         |
| `npm run preview`| Preview production build           |

## Docker

```bash
cd web
docker build -t preshot .
docker run -p 8080:80 preshot
```

The production build is served by Nginx on port 80 inside the container.
