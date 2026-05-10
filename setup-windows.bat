@echo off
REM ─── ClipAI : installation des dépendances ──────────────────────
REM Double-clique sur ce fichier UNE SEULE FOIS pour tout installer

cd /d "%~dp0"

echo.
echo ════════════════════════════════════════════════════
echo  ClipAI - Installation
echo ════════════════════════════════════════════════════
echo.

REM Vérifier Python
echo [1/4] Verification de Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERREUR : Python n'est pas installe.
    echo.
    echo  1. Va sur https://www.python.org/downloads/
    echo  2. Clique sur le bouton "Download Python"
    echo  3. Lance l'installeur
    echo  4. IMPORTANT : coche "Add Python to PATH" en bas !
    echo  5. Clique "Install Now"
    echo  6. Redemarre ce fichier quand c'est fait.
    echo.
    pause
    exit /b 1
)
python --version
echo OK
echo.

REM Vérifier Node
echo [2/4] Verification de Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERREUR : Node.js n'est pas installe.
    echo.
    echo  1. Va sur https://nodejs.org/
    echo  2. Clique sur le bouton "LTS" (a gauche)
    echo  3. Lance l'installeur et clique "Suivant" jusqu'au bout
    echo  4. Redemarre ce fichier quand c'est fait.
    echo.
    pause
    exit /b 1
)
node --version
echo OK
echo.

REM Vérifier ffmpeg
echo [3/4] Verification de ffmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo ffmpeg non trouve. Tentative d'installation automatique...
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements 2>nul
    ffmpeg -version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo ATTENTION : ffmpeg n'a pas pu etre installe automatiquement.
        echo.
        echo Installe-le manuellement :
        echo  1. Va sur https://www.gyan.dev/ffmpeg/builds/
        echo  2. Clique sur "ffmpeg-release-essentials.zip"
        echo  3. Extrais le ZIP dans C:\ffmpeg
        echo  4. Dans le menu Demarrer, cherche "Variables d'environnement"
        echo  5. Edite la variable "Path" et ajoute : C:\ffmpeg\bin
        echo  6. Redemarre l'ordinateur et relance ce fichier.
        echo.
        pause
        exit /b 1
    )
)
echo OK
echo.

REM Installer paquets Python
echo [4/4] Installation des paquets Python et Node...
echo  (peut prendre 2-5 minutes, ne ferme pas la fenetre)
echo.

cd backend
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERREUR lors de l'installation des paquets Python.
    echo Copie le message d'erreur ci-dessus et envoie-le pour de l'aide.
    pause
    exit /b 1
)
cd ..

call npm install --silent
if errorlevel 1 (
    echo.
    echo ERREUR lors de l'installation des paquets Node.
    pause
    exit /b 1
)

echo.
echo ════════════════════════════════════════════════════
echo  Installation terminee !
echo ════════════════════════════════════════════════════
echo.
echo  Lance start-windows.bat pour demarrer l'application.
echo.
pause
