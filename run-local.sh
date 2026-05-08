#!/bin/sh
# Chạy Cryptid4 local
# - Solo (không cần LAN): npm run vite  → http://localhost:5173
# - Duel LAN/online (Socket.IO): npm start → http://localhost:5173

cd "$(dirname "$0")"

MODE=${1:-solo}

if [ "$MODE" = "lan" ]; then
  echo "Khởi động chế độ LAN/online (Express + Vite + Socket.IO)..."
  npm start
else
  echo "Khởi động chế độ Solo (Vite thuần)..."
  npm run vite
fi
