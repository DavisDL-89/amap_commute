# Git 提交指南

## 前提

- 已安装 Git
- 已在 GitHub 创建空仓库（或使用已有仓库）

## 常用命令

在项目根目录（本仓库根目录）执行：

```bash
git status
git add .
git commit -m "你的提交说明"
git push origin main
```

首次克隆或本地新建仓库后设置远程（将 `YOUR_USER` / 仓库名换成你的）：

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## HTTPS 认证

若提示输入密码，请使用 **Personal Access Token**（非账户密码）：

1. <https://github.com/settings/tokens> 创建 classic token，勾选 `repo`
2. 提示输入密码时粘贴 Token

用户名示例：你的 GitHub 用户名（勿在文档中保存真实 Token）。

## 脱敏说明

推送前请确认：

- 无 `.env`、`secrets.yaml`、真实 API Key 片段
- 文档与脚本中无本机绝对路径、私人邮箱（若需可改用 `user@users.noreply.github.com`）

## 相关文件

- `README.md` — 使用说明
- `VERSION_NOTES.md` — 版本记录（若存在）
