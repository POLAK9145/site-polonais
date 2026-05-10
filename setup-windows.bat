@echo off
REM ─── ClipAI : installation des dépendances ──────────────────────
REM Double-clique sur ce fichier UNE SEULE FOIS pour tout installer

cd /d "%~dp0"

echo.
echo ════════════════════════════════════════════════════
echo  📦 Installation de ClipAI
echo ════════════════════════════════════════════════════
echo.

REM Vérifier Python
echo [1/4] Vérification de Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python n'est pas installé.
    echo    Télécharge-le ici : https://www.python.org/downloads/
    echo    IMPORTANT : coche "Add Python to PATH" pendant l'installation.
    pause
    exit /b 1
)
python --version
echo ✅ Python OK
echo.

REM Vérifier Node
echo [2/4] Vérification de Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js n'est pas installé.
    echo    Télécharge-le ici : https://nodejs.org/
    pause
    exit /b 1
)
node --version
echo ✅ Node.js OK
echo.

REM Vérifier ffmpeg
echo [3/4] Vérification de ffmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo ⚠️  ffmpeg n'est pas installé.
    echo    Tentative d'installation via winget...
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo ❌ Installation automatique échouée.
        echo    Installe ffmpeg manuellement :
        echo      1. Va sur https://www.gyan.dev/ffmpeg/builds/
        echo      2. Télécharge "ffmpeg-release-essentials.zip"
        echo      3. Extrais le dossier dans C:\ffmpeg
        echo      4. Ajoute C:\ffmpeg\bin au PATH système
        pause
        exit /b 1
    )
    echo ⚠️  Redémarre l'invite de commandes après installation pour que ffmpeg soit reconnu.
)
echo ✅ ffmpeg OK
echo.

REM Installer dépendances Python
echo [4/4] Installation des dépendances...
echo.
echo  → Python (peut prendre quelques minutes)...
cd backend
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ Échec de l'installation des paquets Python.
    pause
    exit /b 1
)
cd ..
echo ✅ Paquets Python installés
echo.

echo  → Node.js...
call npm install
if errorlevel 1 (
    echo ❌ Échec de l'installation des paquets Node.
    pause
    exit /b 1
)
echo ✅ Paquets Node installés
echo.

echo ════════════════════════════════════════════════════
echo  🎉 Installation terminée !
echo ════════════════════════════════════════════════════
echo.
echo  Pour lancer l'app : double-clique sur start-windows.bat
echo.
pause
