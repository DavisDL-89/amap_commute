@echo off
chcp 65001 >nul
echo ======================================
echo   Git 仓库初始化（脚本目录 = 项目根）
echo ======================================
echo.

cd /d "%~dp0"

set "PATH=%PATH%;C:\Program Files\Git\bin;C:\Program Files\Git\cmd"

git --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [错误] 未检测到 Git，请先安装 Git for Windows。
  pause
  exit /b 1
)

echo 当前目录:
cd
echo.

set /p gh_user="请输入 GitHub 用户名: "
if "%gh_user%"=="" (
  echo [错误] 用户名为空。
  pause
  exit /b 1
)

set /p git_email="请输入用于提交的邮箱（可用 GitHub 隐私邮箱）: "
if "%git_email%"=="" (
  echo [错误] 邮箱为空。
  pause
  exit /b 1
)

git config user.name "%gh_user%"
git config user.email "%git_email%"

if not exist ".git" (
  git init
  git branch -M main
) else (
  echo [信息] 已存在 .git 目录
)

set "REMOTE_URL=https://github.com/%gh_user%/amap_commute.git"
echo.
echo 将使用远程仓库（请确保已在 GitHub 创建同名仓库，或稍后手动修改）:
echo   %REMOTE_URL%
echo.

git remote remove origin 2>nul
git remote add origin "%REMOTE_URL%"
git remote -v

echo.
echo 下一步: 编辑并保存代码后运行 git-commit.bat，或手动 git add / commit / push
echo.
pause
