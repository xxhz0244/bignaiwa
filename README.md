# 合成大奶娃 · 书院积分后端

北京师范大学珠海校区校内使用。学生用 **6 位专属 ID + 中文昵称** 注册，**积分永久累积**。

**身份规则**：每人一个 6 位专属 ID（必填、全局唯一）；昵称**只能中文、1~5 字、全局唯一、一经设定不可修改**。
换手机 / 清缓存后，用专属 ID 即可找回身份和积分。

**书院榜规则**：每个书院取**单局最高分最高的前 20 人**——**每人只占一个坑**（用其单局最高分那条），
分数求和即为书院总分。榜单列出这 20 人各自的分数、昵称、年级、时间。

零依赖：只用 Node 内置模块，不需要 `npm install`，数据存本地 JSON 文件。

---

## 一、本地跑起来

需要 Node 18 以上（[nodejs.org](https://nodejs.org) 下载 LTS 版）。

```bash
cd bignaiwa-backend
node server.js
```

打开 <http://localhost:8787/> 就能玩「合成大奶娃」并参与书院榜；<http://localhost:8787/demo.html> 是演示页，可单独验证接口与看榜。

跑一遍自测（另开一个终端）：

```bash
node test.js
```

看到 `34 通过 / 0 失败` 就说明一切正常。

---

## 二、文件说明

| 文件 | 作用 |
|---|---|
| `config.js` | **所有规则都在这里改**：书院列表、年级、前 N 名、积分换算、防刷阈值、端口、ID/昵称规则 |
| `server.js` | HTTP 服务 + 全部接口 |
| `store.js` | 数据持久化（内存 + JSON 原子落盘） |
| `public/backend.js` | 前端接入脚本（SDK），游戏里引入它就能用 |
| `public/board.js` | 游戏集成：结算提交 + 书院榜弹窗 + 身份弹窗 |
| `public/index.html` / `style.css` / `game.js` | 游戏前端（已接入积分系统） |
| `public/demo.html` | 演示页，用来验证接口和看榜（正式上线后可删） |
| `test.js` | 接口自测 |
| `data/db.json` | 数据文件（运行后自动生成，正式上线前记得清空） |

---

## 三、接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/player` | 注册/更新身份（6 位 ID、中文昵称、年级、书院） |
| POST | `/api/claim` | 换设备用专属 ID 找回身份 |
| GET | `/api/me?uid=` | 查自己的积分与排名 |
| POST | `/api/submit` | 提交一局成绩 |
| GET | `/api/leaderboard/colleges` | 书院榜（含各书院前 20 人明细） |
| GET | `/api/leaderboard/college?college=乐育` | 单个书院的前 20 人明细 |
| GET | `/api/recent` | 最近 50 条成绩 |
| GET | `/api/stats` | 总览统计 |
| GET | `/api/admin/export?token=` | 导出全量数据 |
| POST | `/api/admin/adjust` | 人工加减分（纠正异常） |
| POST | `/api/admin/drop-score` | 从某书院榜里删掉某人全部成绩 |

`GET /api/leaderboard/college?college=乐育` 返回示例：

```json
{
  "college": "乐育",
  "topN": 20,
  "total": 181000,
  "entries": [
    { "rank": 1, "score": 10000, "uid": "100020", "nickname": "赵", "grade": "大一", "at": 1759... },
    { "rank": 2, "score": 9900,  "uid": "100021", "nickname": "钱", "grade": "大二", "at": 1759... }
  ]
}
```

`entries` 里**没有重复 uid**——同一个人只出现一次，且用的是他单局最高分那条。

---

## 四、接入游戏前端

游戏文件（`index.html` / `style.css` / `game.js` / `sponsor.js` / `assets`）已经放进 `public/`，
并改好了两处接入点：`game.js` 在结算时调用 `window.DanaiwaBoard.onGameOver({score, drops, durationMs})`，
`index.html` 末尾加载 `backend.js` 和 `board.js`。**开箱即用，无需再改游戏代码。**

```
public/
  index.html      ← 游戏首页（已接好）
  style.css
  game.js         ← 已暴露 drops / startTime 并传给 onGameOver
  sponsor.js
  assets/
  backend.js      ← 前端 SDK
  board.js        ← 结算提交 + 书院榜弹窗 + 身份弹窗
  demo.html       ← 演示页，正式上线后可删
```

如果前端和后端不同域名，在引入 `backend.js` **之前**先指定后端地址：

```html
<script>window.BNW_BASE = 'https://你的后端域名';</script>
<script src="backend.js"></script>
<script src="board.js"></script>
```

### 身份弹窗（已内置）

`board.js` 在页面加载时，若本地没有身份，会自动弹出设置弹窗：填 **6 位专属 ID**（必填）+ **中文昵称**（1~5 字）
+ 年级 + 书院。注册成功后会把专属 ID 再展示一次，提醒玩家记住（换设备找回用）。
这些都已写好，不用自己写 UI。

### 游戏结算时提交成绩

`board.js` 已实现 `window.DanaiwaBoard.onGameOver`，内部调用 `BNW.submit` 并刷新结算弹窗文案，
你无需改动。若要自己处理，逻辑如下：

```js
BNW.submit({
  score: 本局得分,
  drops: 本局投放次数,        // game.js 已提供
  durationMs: 本局时长毫秒,   // game.js 已提供
}).then(function (r) {
  // r.lastScore 当前分（最近一局得分）
  // r.bestScore 我的单局最高分
  // r.collegeRank 书院内排名（按最高分）
}).catch(function (e) {
  // e.queued 为 true 表示已存进补交队列，联网后自动重试
});
```

### 原排行榜 `leaderboard.min.js` 怎么办

已被 `board.js` **完全替换**：原来的 TinyWebDB「最近高手榜」不再使用，书院积分榜走新后端。
`leaderboard.min.js` 可以删掉（已在部署目录里移除引用）。

---

## 五、部署（正式使用）

### 方案 A · 一台云服务器（推荐，最省心）

1. 买一台轻量应用服务器（腾讯云/阿里云，2 核 2G 足够，新人常有几十元一年的活动）。
2. 装 Node：`curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt install -y nodejs`（Ubuntu 示例）
3. 把 `bignaiwa-backend` 整个目录传上去。
4. 用进程守护启动，崩了自动重启：

```bash
npm i -g pm2
pm2 start server.js --name bignaiwa
pm2 startup && pm2 save      # 开机自启
```

5. 用 Nginx 反代 + 免费 HTTPS 证书：

```nginx
server {
  listen 443 ssl;
  server_name 你的域名;
  ssl_certificate     /etc/letsencrypt/live/你的域名/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/你的域名/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

证书用 `certbot --nginx` 一键申请。学校如果有现成的域名，让它解析到这台机器即可。

### 方案 B · 云托管（不想管服务器）

腾讯云 CloudBase「云托管」或阿里云函数计算，上传代码目录、选 Node 运行环境即可，
自带 HTTPS 和域名，扩缩容自动。缺点是有一点学习成本，且冷启动偶有延迟。

### 方案 C · 先在校内一台机器上试

随便一台常年开机的电脑/实验室内网服务器，`node server.js` 就能跑，
校内用 `http://内网IP:8787` 访问。适合先小范围验证。

---

## 六、上线前必须做的事

- [ ] 改 `config.js` 里的 `ADMIN_TOKEN`，不要用默认值
- [ ] 把 `ALLOW_ORIGIN` 从 `*` 改成你的前端域名（前后端同域名部署就不用改）
- [ ] 确认 `COLLEGES` / `GRADES` 与实际一致
- [ ] 确认 `TOP_N`（每个书院取前几人）
- [ ] 确认 `UID_LEN` / 昵称规则符合预期
- [ ] 个人成绩口径：当前分 = 最近一局得分，最高分 = 历史单局最高；无累计永久总分、无每日上限
- [ ] 清空 `data/db.json`，重启服务，让测试数据归零
- [ ] **每日备份 `data/db.json`**，一条 crontab 就够：
      `0 4 * * * cp /path/bignaiwa-backend/data/db.json /backup/db-$(date +\%F).json`
- [ ] 有 HTTPS 之后，把前端里的 `BNW_BASE` 改成 `https://` 开头的地址

---

## 七、运维速查

```bash
pm2 logs bignaiwa          # 看日志
pm2 restart bignaiwa       # 重启
pm2 stop bignaiwa          # 停止（会先把数据落盘）
curl "http://localhost:8787/api/stats"                    # 看总人数、总局数、最高分合计
curl "http://localhost:8787/api/admin/export?token=你的口令" > backup.json   # 导出备份
```

> 注：已取消「累计积分 / 人工调分」机制，原 `POST /api/admin/adjust` 接口已停用（返回 410）。
> 如需修正，请用下面的 `drop-score` 从书院榜移除异常成绩。

从某个书院榜里删掉某人全部成绩（比如确认是机器刷出来的）：

```bash
curl -X POST http://localhost:8787/api/admin/drop-score \
  -H "Content-Type: application/json" \
  -d '{"token":"你的口令","college":"知行","uid":"玩家uid","reason":"机器刷分"}'
```

---

## 八、常见问题

**Q：学生清了浏览器缓存，积分是不是没了？**
A：不会，前提是记住了自己的 6 位专属 ID。清缓存只是丢了本地的 ID 记录，用「专属 ID」
在弹窗里找回就能恢复身份和积分。所以要在游戏里提醒学生牢记自己的专属 ID（注册成功时已展示过一次）。
没记住 ID 的，积分确实找不回来了。

**Q：两个人的专属 ID 撞了怎么办？**
A：6 位 ID 共一百万种，撞的概率极低；万一撞了，服务端注册时会提示「该专属 ID 已被使用」，换一个即可。

**Q：昵称被别人占了 / 想改昵称怎么办？**
A：昵称全局唯一且一经设定不可修改（这是需求约定的）。如果确实需要改，只能用管理员接口
`/api/admin/adjust` 之外的手段（直接改 `data/db.json` 或联系开发者）处理，普通玩家无法自助改。

**Q：有人刷分怎么办？**
A：服务端已有四道防线：3 秒最小提交间隔、单日 50 局计分上限、时长校验、
分数与投放次数比例校验。超过 20 万的分数会被标记 `suspicious` 留痕。
真出了异常，用 `/api/admin/drop-score` 删掉该人成绩或 `/api/admin/adjust` 扣分即可。想更严就调 `config.js` 里的阈值。

**Q：数据量大了 JSON 撑得住吗？**
A：几千人、几十万条成绩完全没问题。真到百万级再换数据库，
只需要替换 `store.js` 里的读写实现，其余代码不用动。

**Q：能改规则吗？**
A：全在 `config.js`，改完 `pm2 restart bignaiwa` 生效。
