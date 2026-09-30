# 部署到 Railway（让别人也能玩）

本目录是一个零依赖的 Node 服务：它同时托管游戏前端（`public/`）和积分接口（`/api/*`），  
所以**只需要部署这一个目录**，前后端同域名，不用配跨域。

部署后你会拿到一个公开网址（如 `xxx.up.railway.app`），任何人都能打开玩。

---

## 方法一：用 GitHub 连接（推荐，最稳）

1. 去 <https://github.com> 注册/登录，新建一个仓库（比如 `bignaiwa`）。
2. 在本机 `bignaiwa-backend` 目录里执行（把 `你的仓库地址` 换成第 1 步的地址）：


   ```bash
   git init
   git add -A
   git commit -m "bignaiwa points backend"
   git branch -M main
   git remote add origin 你的仓库地址
   git push -u origin main
   ```
3. 打开 <https://railway.app> ，用 GitHub 登录，点 **New Project → Deploy from GitHub repo**，  
   选中刚才的仓库，Railway 会自动识别 Node 项目。
4. 在 Railway 项目里：
   - **Settings → Build & Deploy**：确认 Start Command 是 `npm start`（已写在 package.json）。
   - **Variables（环境变量）**：至少加一条 `ADMIN_TOKEN`，值设成一个**你自己想的复杂口令**（别用默认值）。  
     以后管理接口 `/api/admin/...` 都要带这个口令。
5. 部署完成后，Railway 会给出一个 `xxx.up.railway.app` 的网址，打开就是游戏。

## 方法二：用 Railway CLI（不用 GitHub）

1. 本机装 CLI（需要已装 Node）：
   ```bash
   npm install -g @railway/cli
   ```
2. 在 `bignaiwa-backend` 目录里：
   ```bash
   railway login        # 浏览器里登录 Railway
   railway init         # 新建项目
   railway variables set ADMIN_TOKEN 你的复杂口令
   railway up           # 上传并部署
   ```
3. 部署完成后 Railway 会给出公开网址。

---

## 上线后必做

- [ ] 在 Railway 的 Variables 里设置 `ADMIN_TOKEN`（已含则说明已设）。
- [ ] 打开公开网址，玩一局，点"书院榜"确认「当前分 / 最高分」正常。
- [ ] 备份数据：在 Railway 的 Variables 里加 `DATA_FILE=/data/db.json`，并在  
  Railway 控制台挂一个 **Volume** 到 `/data`，这样数据不会因为重新部署而丢失。  
  （不挂卷也能玩，只是重新部署时榜单会清空；一个小游戏可先不挂。）

## 常见问题

- **国内访问偏慢**：Railway 服务器在海外，北师珠同学打开可能要等一两秒。能玩，只是不是秒开。  
  若想国内飞快，改腾讯云 CloudBase（见 README「部署」相关说明或问我）。
- **改了代码怎么更新**：重新 `git push`（方法一）或 `railway up`（方法二）即可，Railway 会自动重新部署。
- **想换新网址 / 自定义域名**：在 Railway 项目 Settings 里改。
