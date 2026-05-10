#!/bin/bash
# Start both the backend and the frontend dev server
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Démarrage du backend FastAPI (port 8000)…"
cd "$ROOT/backend"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

echo "🎨 Démarrage du frontend React (port 5173)…"
cd "$ROOT"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ ClipAI est prêt !"
echo "   Frontend : http://localhost:5173"
echo "   Backend  : http://localhost:8000"
echo ""
echo "Ctrl+C pour arrêter."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
