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

REM Récupérer l'adresse IP locale pour accès depuis le téléphone
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set "LOCAL_IP=%%a"
    goto :ip_found
)
:ip_found
set "LOCAL_IP=%LOCAL_IP: =%"

echo 🔧 Lancement du backend (port 8000)...
start "ClipAI Backend" cmd /k "cd backend && python -m uvicorn main:app --port 8000 --host 0.0.0.0"

timeout /t 3 /nobreak >nul

echo 🎨 Lancement du frontend (port 5173)...
start "ClipAI Frontend" cmd /k "npm run dev -- --host"

timeout /t 5 /nobreak >nul

echo.
echo ════════════════════════════════════════════════════
echo  ✅ ClipAI est prêt !
echo ════════════════════════════════════════════════════
echo.
echo  Sur ce PC :
echo    👉  http://localhost:5173
echo.
echo  Sur ton telephone (meme WiFi) :
echo    👉  http://%LOCAL_IP%:5173
echo.
echo  Pour arrêter : ferme les deux fenêtres "ClipAI Backend"
echo  et "ClipAI Frontend".
echo ════════════════════════════════════════════════════
echo.

REM Ouvrir automatiquement le navigateur
start http://localhost:5173

pause
