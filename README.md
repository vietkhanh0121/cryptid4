# Cryptid4

React/Vite board game with solo mode and online duel mode.

## Local

Install dependencies:

```sh
npm install
```

Run frontend only:

```sh
npm run vite
```

Run full local server with frontend and Socket.IO:

```sh
npm start
```

Run Socket.IO server only:

```sh
npm run server
```

Open:

```txt
http://localhost:5173
```

## GitHub Pages

This repo includes a GitHub Pages workflow at:

```txt
.github/workflows/deploy-pages.yml
```

On push to `main`, GitHub builds with:

```sh
npm ci
npm run build
```

Then it publishes `dist`.

Important: GitHub Pages only hosts the static frontend. Online duel needs the Render Socket.IO server. Set this GitHub Actions repository variable:

```txt
VITE_SOCKET_URL=https://your-render-service.onrender.com
```

The workflow already passes this variable into `npm run build`.

## Render

Render is used as a Socket.IO server only. The included `render.yaml` uses:

```txt
Build Command: npm install
Start Command: npm run server
```

Render provides `PORT`; `server-only.mjs` uses it automatically.

After Render deploys, copy the Render service URL into the GitHub repository variable `VITE_SOCKET_URL`, then rerun the GitHub Pages workflow.

`server.mjs` is still available for running frontend and Socket.IO together locally or on a single Node host.
