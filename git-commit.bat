@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PATH=%PATH%;C:\Program Files\Git\bin;C:\Program Files\Git\cmd"

git --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [错误] 未检测到 Git。
  pause
  exit /b 1
)

echo 状态:
git status
echo.

git add .
git commit -m "chore: sync project (see manifest.json for integration version)"

if %ERRORLEVEL% NEQ 0 (
  echo [提示] 无新更改或提交失败。若首次提交请先配置: git config user.name / user.email
  pause
  exit /b 1
)

echo.
echo 推送到 origin main ...
git push origin main

if %ERRORLEVEL% NEQ 0 (
  echo [错误] push 失败，请检查远程地址与 Token。
  pause
  exit /b 1
)

echo 完成。
pause
