// BigNaiWa 积分后端 · 零依赖 HTTP 服务
// 启动： node server.js
// 依赖： 无（只用 Node 内置模块），Node 18+ 即可

const http = require('http');
const fs = require('fs');
const path = require('path');
const CFG = require('./config');
const store = require('./store');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

// ── 工具 ────────────────────────────────────────────────
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': CFG.ALLOW_ORIGIN,
  });
  res.end(body);
}
const ok = (res, o) => json(res, 200, Object.assign({ ok: true }, o));
const err = (res, code, msg) => json(res, code, { ok: false, error: msg });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1048576) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function inList(v, list) { return typeof v === 'string' && list.includes(v); }

// 专属 ID：6 位纯数字，必填，全局唯一（即账号号）
function validUid(u) { return typeof u === 'string' && new RegExp('^\\d{' + CFG.UID_LEN + '}$').test(u); }
// 昵称：仅中文、1~5 字、全局唯一、一经设定不可修改
const NICK_RE = /^[一-龥]{1,5}$/;
function validNick(n) { return typeof n === 'string' && NICK_RE.test(n); }

// ── 业务 ────────────────────────────────────────────────
// uid 即主键；昵称唯一且不可改；书院 / 年级可改。
function upsertPlayer(b) {
  const db = store.db();
  const uid = b.uid;
  const college = inList(b.college, CFG.COLLEGES) ? b.college : null;
  const grade = inList(b.grade, CFG.GRADES) ? b.grade : null;
  const nickname = b.nickname;

  let p = db.players[uid];
  if (p) {
    // 已存在：昵称不可修改，必须与当初一致
    if (nickname !== p.nickname) {
      return { error: 409, msg: '昵称一经设定不可修改（如需变更请联系管理员）' };
    }
    if (college) p.college = college;
    if (grade) p.grade = grade;
    store.save();
    return { player: p };
  }

  // 新账号：昵称全局唯一
  const taken = Object.values(db.players).some((x) => x.nickname === nickname);
  if (taken) {
    return { error: 409, msg: '昵称「' + nickname + '」已被占用，请换一个中文昵称' };
  }

  p = {
    uid,
    nickname,
    college: college || CFG.COLLEGES[0],
    grade: grade || CFG.GRADES[0],
    lastScore: 0,            // 当前分（最近一局得分）
    bestScore: 0,            // 单局最高分（用于书院榜）
    plays: 0,
    lastSubmitAt: 0,
    createdAt: Date.now(),
    suspiciousCount: 0,
  };
  db.players[uid] = p;
  store.save();
  return { player: p };
}

// 回传给本人的信息（不泄露其他玩家数据）
function publicPlayer(p) {
  return {
    uid: p.uid, nickname: p.nickname, college: p.college, grade: p.grade,
    lastScore: p.lastScore, bestScore: p.bestScore, plays: p.plays,
  };
}

function allPlayers() {
  return Object.values(store.db().players);
}

// 按「单局最高分」排名（与书院榜口径一致）
function byBest(a, b) { return b.bestScore - a.bestScore || a.createdAt - b.createdAt; }

function rankOf(p) {
  const sorted = allPlayers().slice().sort(byBest);
  const global = sorted.findIndex((x) => x.uid === p.uid) + 1;
  const mates = allPlayers().filter((x) => x.college === p.college).sort(byBest);
  const inCollege = mates.findIndex((x) => x.uid === p.uid) + 1;
  return { rank: global, collegeRank: inCollege, total: sorted.length, collegeTotal: mates.length };
}

// 每个书院维护一份成绩榜（计量单位是单局成绩，含 uid 以便按人去重）
function pushCollegeTop(college, entry) {
  const db = store.db();
  if (!db.collegeTop) db.collegeTop = {};
  const arr = db.collegeTop[college] || (db.collegeTop[college] = []);
  arr.push(entry);
  arr.sort((a, b) => b.score - a.score || a.at - b.at);
  if (arr.length > CFG.TOP_KEEP) arr.length = CFG.TOP_KEEP;
}

function collegeTopList(name) {
  const db = store.db();
  return (db.collegeTop && db.collegeTop[name]) ? db.collegeTop[name].slice() : [];
}

// 书院榜：按人去重，每人取单局最高分，取前 TOP_N 人求和
function collegeBoard() {
  const board = CFG.COLLEGES.map((name) => {
    const entries = collegeTopList(name);
    const bestByUid = new Map();
    for (const e of entries) {
      const cur = bestByUid.get(e.uid);
      if (!cur || e.score > cur.score) bestByUid.set(e.uid, e);
    }
    const picked = [...bestByUid.values()]
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, CFG.TOP_N);
    return {
      college: name,
      total: picked.reduce((s, e) => s + e.score, 0),
      counted: picked.length,                                   // 实际计入的人数
      players: allPlayers().filter((p) => p.college === name).length,
      entries: picked.map((e, i) => ({
        rank: i + 1, score: e.score, uid: e.uid, nickname: e.nickname, grade: e.grade, at: e.at,
      })),
    };
  });
  return board.sort((a, b) => b.total - a.total);
}

// ── 路由 ────────────────────────────────────────────────
const routes = {
  'GET /api/health': async (res) =>
    ok(res, { service: 'bignaiwa-points', players: allPlayers().length }),

  // 注册 / 更新身份（昵称、书院、年级；uid 必填且唯一）
  'POST /api/player': async (res, b) => {
    if (!validUid(b.uid)) return err(res, 400, '专属 ID 必须是 ' + CFG.UID_LEN + ' 位数字');
    if (!validNick(b.nickname)) return err(res, 400, '昵称只能包含中文、且 1~5 个字');
    if (!inList(b.college, CFG.COLLEGES)) return err(res, 400, '请选择书院');
    if (!inList(b.grade, CFG.GRADES)) return err(res, 400, '请选择年级');
    const r = upsertPlayer(b);
    if (r.error) return err(res, r.error, r.msg);
    return ok(res, Object.assign(publicPlayer(r.player), rankOf(r.player)));
  },

  // 换设备 / 清缓存后用专属 ID 找回身份
  'POST /api/claim': async (res, b) => {
    if (!validUid(b.uid)) return err(res, 400, '专属 ID 必须是 ' + CFG.UID_LEN + ' 位数字');
    const p = store.db().players[b.uid];
    if (!p) return err(res, 404, '没找到该专属 ID 对应的账号');
    return ok(res, Object.assign(publicPlayer(p), rankOf(p)));
  },

  'GET /api/me': async (res, b, q) => {
    const p = store.db().players[q.uid];
    if (!p) return err(res, 404, '身份不存在或已失效');
    return ok(res, Object.assign(publicPlayer(p), rankOf(p)));
  },

  // 提交一局成绩
  'POST /api/submit': async (res, b) => {
    if (!validUid(b.uid)) return err(res, 400, '专属 ID 不合法');
    const p = store.db().players[b.uid];
    if (!p) return err(res, 404, '身份不存在，请先注册');

    const score = Math.floor(Number(b.score));
    if (!Number.isFinite(score) || score < 0) return err(res, 400, '分数不合法');
    if (score > CFG.MAX_SCORE) return err(res, 400, '分数超出上限');

    const drops = Math.floor(Number(b.drops) || 0);
    const durationMs = Math.floor(Number(b.durationMs) || 0);

    // 频控
    const now = Date.now();
    if (p.lastSubmitAt && now - p.lastSubmitAt < CFG.MIN_SUBMIT_INTERVAL_MS) {
      return err(res, 429, '手速太快了，歇一下再来');
    }
    // 时长校验：真实一局不可能 2 秒结束
    if (durationMs > 0 && durationMs < CFG.MIN_MS_PER_PLAY) {
      return err(res, 400, '这局时长不合理');
    }
    // 分数与投放次数比例校验
    if (drops > 0 && score > drops * 400) {
      return err(res, 400, '分数与投放次数不匹配');
    }

    // 个人成绩：当前分 = 本局；最高分 = 历史最大（无每日上限、不累计）
    p.lastScore = score;
    if (score > p.bestScore) p.bestScore = score;
    p.plays += 1;
    p.lastSubmitAt = now;

    const suspicious = score > CFG.SUSPICIOUS_SCORE;
    if (suspicious) p.suspiciousCount = (p.suspiciousCount || 0) + 1;

    if (score > 0) {
      const db = store.db();
      db.recent.unshift({
        uid: p.uid, nickname: p.nickname, college: p.college, grade: p.grade,
        score, at: now, suspicious,
      });
      if (db.recent.length > 200) db.recent.length = 200;

      // 计入书院榜（按人去重，每人取单局最高分；无每日上限）
      pushCollegeTop(p.college, {
        uid: p.uid, nickname: p.nickname, grade: p.grade, score, at: now,
      });
    }

    store.save();
    return ok(res, Object.assign(publicPlayer(p), rankOf(p), {
      suspicious,
    }));
  },

  // 书院榜：每个书院取单局最高分最高的前 N 人
  'GET /api/leaderboard/colleges': async (res) =>
    ok(res, { topN: CFG.TOP_N, board: collegeBoard() }),

  // 单个书院的前 N 人明细（按人去重，每人取最高分）
  'GET /api/leaderboard/college': async (res, b, q) => {
    const name = q.college;
    if (!inList(name, CFG.COLLEGES)) return err(res, 400, '书院不合法：' + name);
    const entries = collegeTopList(name);
    const bestByUid = new Map();
    for (const e of entries) {
      const cur = bestByUid.get(e.uid);
      if (!cur || e.score > cur.score) bestByUid.set(e.uid, e);
    }
    const picked = [...bestByUid.values()]
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, CFG.TOP_N);
    return ok(res, {
      college: name,
      topN: CFG.TOP_N,
      total: picked.reduce((s, e) => s + e.score, 0),
      entries: picked.map((e, i) => ({
        rank: i + 1, score: e.score, uid: e.uid, nickname: e.nickname, grade: e.grade, at: e.at,
      })),
    });
  },

  'GET /api/recent': async (res) => ok(res, { list: store.db().recent.slice(0, 50) }),

  'GET /api/stats': async (res) => {
    const ps = allPlayers();
    const byCollege = {};
    for (const c of CFG.COLLEGES) byCollege[c] = { players: 0, topTotal: 0, counted: 0 };
    for (const p of ps) {
      if (byCollege[p.college]) byCollege[p.college].players += 1;
    }
    for (const c of CFG.COLLEGES) {
      const entries = collegeTopList(c);
      const bestByUid = new Map();
      for (const e of entries) {
        const cur = bestByUid.get(e.uid);
        if (!cur || e.score > cur.score) bestByUid.set(e.uid, e);
      }
      const picked = [...bestByUid.values()].sort((a, b) => b.score - a.score).slice(0, CFG.TOP_N);
      byCollege[c].topTotal = picked.reduce((s, e) => s + e.score, 0);
      byCollege[c].counted = picked.length;
    }
    return ok(res, {
      players: ps.length,
      plays: ps.reduce((s, p) => s + p.plays, 0),
      bestTotal: ps.reduce((s, p) => s + p.bestScore, 0),
      byCollege,
    });
  },

  // ── 管理接口（需要 ADMIN_TOKEN）──────────────────────
  'GET /api/admin/export': async (res, b, q) => {
    if (q.token !== CFG.ADMIN_TOKEN) return err(res, 403, '口令错误');
    return ok(res, { players: allPlayers(), recent: store.db().recent });
  },
  'POST /api/admin/adjust': async (res, b) => {
    if (b.token !== CFG.ADMIN_TOKEN) return err(res, 403, '口令错误');
    return err(res, 410, '已取消「累计积分」机制，本接口不再可用');
  },
  // 从某个书院榜里移除某人的全部成绩（核实为刷分时用）
  'POST /api/admin/drop-score': async (res, b) => {
    if (b.token !== CFG.ADMIN_TOKEN) return err(res, 403, '口令错误');
    if (!inList(b.college, CFG.COLLEGES)) return err(res, 400, '书院不合法');
    if (!validUid(b.uid)) return err(res, 400, '专属 ID 不合法');
    const arr = collegeTopList(b.college);
    const db = store.db();
    const before = arr.length;
    const removed = arr.filter((e) => e.uid === b.uid);
    const after = arr.filter((e) => e.uid !== b.uid);
    db.collegeTop[b.college] = after;
    store.save();
    return ok(res, { removedCount: before - after.length, removed, reason: b.reason || '' });
  },
};

// ── 静态文件 ────────────────────────────────────────────
function serveStatic(req, res, urlPath) {
  const root = path.resolve(__dirname, CFG.PUBLIC_DIR);
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ── 启动 ────────────────────────────────────────────────
store.load();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CFG.ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const query = Object.fromEntries(u.searchParams);
  const key = `${req.method} ${p}`;

  if (routes[key]) {
    let body = query;
    if (req.method === 'POST') {
      try { body = await readBody(req); }
      catch (e) { return err(res, 400, e.message); }
    }
    try { await routes[key](res, body, query); }
    catch (e) { console.error('[route]', key, e); return err(res, 500, '服务器内部错误'); }
    return;
  }

  if (p.startsWith('/api/')) return err(res, 404, '接口不存在');
  serveStatic(req, res, p);
});

server.listen(process.env.PORT || CFG.PORT, () => {
  console.log(`[server] BigNaiWa 积分后端已启动： http://localhost:${process.env.PORT || CFG.PORT}`);
  console.log(`[server] 数据文件： ${store.DATA_FILE}`);
  console.log(`[server] 书院： ${CFG.COLLEGES.join(' / ')}`);
  console.log(`[server] 书院榜规则：每个书院取单局最高分最高的前 ${CFG.TOP_N} 人，每人只占一个坑`);
});

function shutdown() {
  console.log('\n[server] 正在保存数据并退出...');
  try { store.flush(); } catch (e) { console.error(e); }
  process.exit(0);
//微信域名校验
app.get('/4276fc9a204622419dfa63872fc02824.txt', (req, res) => {
  res.setHeader('Content-Type','text/plain');
  res.send('0805e9037e78b3181ec5d9d1828d4390d6d34afe');
});
