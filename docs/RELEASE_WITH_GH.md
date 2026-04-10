# 使用 GitHub CLI 发布 Release

## 1. 安装 CLI（Windows）

```powershell
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
```

安装后**新开一个终端**，或把 `C:\Program Files\GitHub CLI` 加入 PATH。

验证：

```powershell
gh version
```

## 2. 登录（只需一次）

```powershell
gh auth login
```

按提示选择：GitHub.com → HTTPS → 浏览器登录或粘贴 Token（需勾选 `repo` 权限）。

检查：

```powershell
gh auth status
```

## 3. 打标签并推送（若尚未推送该版本）

版本号以 `custom_components/amap_commute/manifest.json` 的 `version` 为准，标签格式为 **`v` + 版本号**（例如 `1.7.6` → `v1.7.6`）。

```powershell
cd E:\Cursor-T\hass
git tag -a v1.7.6 -m "v1.7.6"
git push origin v1.7.6
```

若标签已存在可跳过。

## 4. 创建 Release（推荐：用仓库内说明文件）

说明文件命名：`docs/GITHUB_RELEASE_<tag>.md`（例如 `docs/GITHUB_RELEASE_v1.7.6.md`）。

```powershell
cd E:\Cursor-T\hass
gh release create v1.7.6 --title "v1.7.6" --notes-file docs/GITHUB_RELEASE_v1.7.6.md --latest
```

`gh` 会从当前目录的 `git remote origin` 推断仓库，一般无需再加 `--repo`。

### 无说明文件时（自动生成）

```powershell
gh release create v1.7.6 --title "v1.7.6" --generate-notes --latest
```

## 5. 已发布后要改说明

```powershell
gh release edit v1.7.6 --notes-file docs/GITHUB_RELEASE_v1.7.6.md
```

## 6. 一键脚本

在项目根目录执行：

```powershell
.\scripts\release-gh.ps1
```

脚本会读取 `manifest.json` 的版本号，查找 `docs/GITHUB_RELEASE_v*.md`，并调用 `gh release create`（需已 `gh auth login`）。

## 7. 设为预发布 / 取消最新

```powershell
gh release edit v1.7.6 --prerelease
gh release edit v1.7.6 --latest
```
