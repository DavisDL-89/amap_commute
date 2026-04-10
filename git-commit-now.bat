@echo off
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\Git\bin;C:\Program Files\Git\cmd"
git add .
git commit -m "chore: update"
git push origin main
pause
