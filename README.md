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

Run full local server with Socket.IO:

```sh
npm start
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

Important: GitHub Pages only hosts the static frontend. Online duel needs a Socket.IO server. If the Socket.IO server is deployed separately, set this GitHub Actions repository variable:

```txt
VITE_SOCKET_URL=https://your-render-service.onrender.com
```

and update the workflow build step to pass it as an env var if needed.

## Render

If deploying the whole game to Render as one Node web service:

```txt
Build Command: npm install && npm run build
Start Command: npm start
```

Render provides `PORT`; `server.mjs` uses it automatically.

When frontend and Socket.IO are on the same Render service, no `VITE_SOCKET_URL` is needed.

