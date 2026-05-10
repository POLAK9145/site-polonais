@echo off
REM ─── ClipAI : démarre l'app sur Windows ─────────────────────────
REM Double-clique sur ce fichier pour lancer l'application

cd /d "%~dp0"

echo.
echo ════════════════════════════════════════════════════
echo  🚀 Démarrage de ClipAI
echo ════════════════════════════════════════════════════
echo.

REM Vérifier que les dépendances sont installées
if not exist "node_modules" (
    echo ⚠️  node_modules manquant. Lance d'abord setup-windows.bat
    pause
    exit /b 1
)

echo 🔧 Lancement du backend (port 8000)...
start "ClipAI Backend" cmd /k "cd backend && python -m uvicorn main:app --port 8000"

timeout /t 3 /nobreak >nul

echo 🎨 Lancement du frontend (port 5173)...
start "ClipAI Frontend" cmd /k "npm run dev"

timeout /t 5 /nobreak >nul

echo.
echo ════════════════════════════════════════════════════
echo  ✅ ClipAI est prêt !
echo ════════════════════════════════════════════════════
echo.
echo  Ouvre ton navigateur sur :
echo.
echo    👉  http://localhost:5173
echo.
echo  Pour arrêter : ferme les deux fenêtres "ClipAI Backend"
echo  et "ClipAI Frontend".
echo ════════════════════════════════════════════════════
echo.

REM Ouvrir automatiquement le navigateur
start http://localhost:5173

pause
