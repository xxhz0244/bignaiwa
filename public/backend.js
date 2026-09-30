// BigNaiWa 积分系统 · 前端接入脚本
// 用法：在 index.html 里 <script src="backend.js"></script>
//       如果后端和前端不同域名，先设置：<script>window.BNW_BASE='https://你的后端域名'</script>

(function () {
  'use strict';

  var BASE = window.BNW_BASE || '';   // 同一域名部署时留空即可
  var LS_UID = 'bnw.uid';
  var LS_PROFILE = 'bnw.profile';
  var LS_QUEUE = 'bnw.queue';

  function get(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function set(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  var profile = null;
  try { profile = JSON.parse(get(LS_PROFILE, 'null')); } catch (e) { profile = null; }

  // 只保留本人可见字段
  function pick(o) {
    return {
      uid: o.uid, nickname: o.nickname, college: o.college, grade: o.grade,
      lastScore: o.lastScore, bestScore: o.bestScore, plays: o.plays,
      rank: o.rank, collegeRank: o.collegeRank,
      total: o.total, collegeTotal: o.collegeTotal,
    };
  }
  function saveProfile(p) {
    profile = p;
    set(LS_PROFILE, JSON.stringify(p));
    if (p && p.uid) set(LS_UID, p.uid);
  }

  async function call(method, path, body) {
    var res = await fetch(BASE + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = await res.json().catch(function () { return { ok: false, error: '返回不是合法 JSON' }; });
    if (!res.ok || data.ok === false) {
      var e = new Error(data.error || ('请求失败 ' + res.status));
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // ── 离线补交队列 ────────────────────────────────────
  function enqueue(item) {
    var q = [];
    try { q = JSON.parse(get(LS_QUEUE, '[]')); } catch (e) { q = []; }
    if (q.length >= 30) q.shift();
    q.push(item);
    set(LS_QUEUE, JSON.stringify(q));
  }
  function readQueue() {
    try { return JSON.parse(get(LS_QUEUE, '[]')); } catch (e) { return []; }
  }
  var flushing = false;
  async function flushQueue() {
    if (flushing || !profile || !profile.uid) return;
    flushing = true;
    try {
      var q = readQueue();
      var done = 0;
      for (var i = 0; i < q.length; i++) {
        var tries = 0;
        var sent = false;
        while (tries < 3 && !sent) {
          try {
            var r = await call('POST', '/api/submit', Object.assign({ uid: profile.uid }, q[i]));
            saveProfile(pick(r));
            sent = true;
          } catch (e) {
            if (e.status === 429) { await sleep(3200); tries++; continue; }
            break;
          }
        }
        if (!sent) break;
        done = i + 1;
        if (i < q.length - 1) await sleep(3200);
      }
      set(LS_QUEUE, JSON.stringify(q.slice(done)));
    } finally {
      flushing = false;
    }
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ── 对外 API ────────────────────────────────────────
  var BNW = {
    COLLEGES: ['乐育', '会同', '知行', '弘文', '砺行'],
    GRADES: ['大一', '大二', '大三', '大四', '研究生'],

    // 本地缓存的身份，没注册过返回 null
    me: function () { return profile; },
    hasIdentity: function () { return !!(profile && profile.uid && profile.college); },
    uid: function () { return profile && profile.uid; },

    // 注册或更新身份（改书院 / 改年级走这个；昵称一经设定不可改）
    register: function (o) {
      return call('POST', '/api/player', {
        uid: o.uid, nickname: o.nickname, college: o.college, grade: o.grade,
      }).then(function (r) { saveProfile(pick(r)); return r; });
    },

    // 换设备 / 清缓存后用专属 ID 找回
    claim: function (o) {
      if (!/^\d{6}$/.test(String(o.uid || ''))) {
        return Promise.reject(new Error('专属 ID 必须是 6 位数字'));
      }
      return call('POST', '/api/claim', { uid: o.uid })
        .then(function (r) { saveProfile(pick(r)); return r; });
    },

    refresh: function () {
      if (!profile || !profile.uid) return Promise.resolve(null);
      return call('GET', '/api/me?uid=' + encodeURIComponent(profile.uid))
        .then(function (r) { saveProfile(pick(r)); return r; });
    },

    // 提交一局成绩。offline 为 true 时网络失败会入队，联网后自动补交
    submit: function (o) {
      if (!profile || !profile.uid) return Promise.reject(new Error('还没设置专属 ID，先注册'));
      var payload = { uid: profile.uid, score: o.score, drops: o.drops, durationMs: o.durationMs };
      return call('POST', '/api/submit', payload).then(function (r) {
        saveProfile(pick(r));
        return r;
      }).catch(function (e) {
        if (e.status === 429 || e.status === 400) throw e;
        enqueue({ score: o.score, drops: o.drops, durationMs: o.durationMs });
        e.queued = true;
        throw e;
      });
    },

    flushQueue: flushQueue,
    pendingCount: function () { return readQueue().length; },

    collegeBoard: function () { return call('GET', '/api/leaderboard/colleges'); },
    collegeDetail: function (college) {
      return call('GET', '/api/leaderboard/college?college=' + encodeURIComponent(college));
    },
    stats: function () { return call('GET', '/api/stats'); },

    // ── 现成的身份选择弹窗，一行就能接入 ──────────────
    // BNW.showIdentityPicker().then(function(profile){ ... })
    showIdentityPicker: function (opts) {
      opts = opts || {};
      var isClaim = !!opts.claim;           // true 时为「找回」模式
      return new Promise(function (resolve, reject) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif';
        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:min(92vw,380px);box-shadow:0 12px 40px rgba(0,0,0,.2)';
        box.innerHTML =
          '<h3 style="margin:0 0 4px;font-size:17px;font-weight:600">' + (isClaim ? '找回我的身份' : '设置你的身份') + '</h3>' +
          '<p style="margin:0 0 16px;font-size:13px;color:#666">你的成绩计入所属书院（按单局最高分排名）</p>' +
          '<div class="bnw-idblock" style="background:#f3f6fb;border:1px solid #dce4f0;border-radius:10px;padding:10px 12px;margin-bottom:12px">' +
          '<label style="display:block;font-size:13px;margin-bottom:4px">专属 ID（' + '6 位数字，必填）</label>' +
          '<input id="bnw-uid" inputmode="numeric" maxlength="6" placeholder="例如 123456" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #cdd6e4;border-radius:8px;font-size:16px;letter-spacing:6px">' +
          '</div>' +
          '<label style="display:block;font-size:13px;margin-bottom:4px">昵称（仅中文，1~5 字，设定后不可改）</label>' +
          '<input id="bnw-nick" maxlength="5" placeholder="例如 奶娃一号" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;font-size:14px">' +
          '<div style="display:flex;gap:10px;margin-bottom:16px">' +
          '<div style="flex:1"><label style="display:block;font-size:13px;margin-bottom:4px">年级</label><select id="bnw-grade" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:14px"></select></div>' +
          '<div style="flex:1"><label style="display:block;font-size:13px;margin-bottom:4px">书院</label><select id="bnw-college" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:14px"></select></div>' +
          '</div>' +
          '<button id="bnw-ok" style="width:100%;padding:11px;border:none;background:#1a73e8;color:#fff;border-radius:10px;font-size:15px;cursor:pointer">' + (isClaim ? '找回' : '开始游戏') + '</button>' +
          '<p id="bnw-msg" style="margin:10px 0 0;font-size:12px;color:#c0392b;min-height:16px;line-height:1.5"></p>';
        wrap.appendChild(box);
        document.body.appendChild(wrap);

        function fill(id, arr, cur) {
          var sel = box.querySelector('#' + id);
          arr.forEach(function (v) {
            var op = document.createElement('option');
            op.value = v; op.textContent = v;
            if (v === cur) op.selected = true;
            sel.appendChild(op);
          });
        }
        fill('bnw-grade', BNW.GRADES, profile && profile.grade);
        fill('bnw-college', BNW.COLLEGES, profile && profile.college);
        if (profile && profile.nickname) box.querySelector('#bnw-nick').value = profile.nickname;
        if (profile && profile.uid) box.querySelector('#bnw-uid').value = profile.uid;
        box.querySelector('#bnw-uid').focus();

        var msg = box.querySelector('#bnw-msg');
        function close() { wrap.remove(); }

        // 只允许输入数字
        box.querySelector('#bnw-uid').addEventListener('input', function () {
          this.value = this.value.replace(/\D/g, '').slice(0, 6);
        });
        // 只允许中文
        box.querySelector('#bnw-nick').addEventListener('input', function () {
          this.value = this.value.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 5);
        });

        box.querySelector('#bnw-ok').onclick = function () {
          var uid = box.querySelector('#bnw-uid').value.trim();
          var nick = box.querySelector('#bnw-nick').value.trim();
          msg.textContent = '';
          if (!/^\d{6}$/.test(uid)) { msg.textContent = '专属 ID 必须是 6 位数字'; return; }
          if (!/^[\u4e00-\u9fa5]{1,5}$/.test(nick)) { msg.textContent = '昵称只能包含中文、且 1~5 个字'; return; }
          var grade = box.querySelector('#bnw-grade').value;
          var college = box.querySelector('#bnw-college').value;

          var done = function (r) {
            close();
            // 注册成功后把专属 ID 再展示一次，方便用户记住
            if (!isClaim) BNW.showIdReminder(uid);
            resolve(r);
          };
          if (isClaim) {
            BNW.claim({ uid: uid }).then(done).catch(function (e) { msg.textContent = e.message; });
          } else {
            BNW.register({ uid: uid, nickname: nick, grade: grade, college: college })
              .then(done).catch(function (e) { msg.textContent = e.message; });
          }
        };
      });
    },

    // 注册成功后提示记住专属 ID
    showIdReminder: function (uid) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif';
      var box = document.createElement('div');
      box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:min(92vw,360px);box-shadow:0 12px 40px rgba(0,0,0,.2);text-align:center';
      box.innerHTML =
        '<div style="font-size:34px">🔑</div>' +
        '<h3 style="margin:8px 0 4px;font-size:17px">记住你的专属 ID</h3>' +
        '<p style="margin:0 0 14px;font-size:13px;color:#666">换手机或清缓存后用它找回积分</p>' +
        '<div style="font-size:30px;font-weight:700;letter-spacing:10px;color:#1a73e8;background:#f3f6fb;border-radius:10px;padding:12px;margin-bottom:16px">' + uid + '</div>' +
        '<button id="bnw-got" style="width:100%;padding:11px;border:none;background:#1a73e8;color:#fff;border-radius:10px;font-size:15px;cursor:pointer">知道了</button>';
      wrap.appendChild(box);
      document.body.appendChild(wrap);
      box.querySelector('#bnw-got').onclick = function () { wrap.remove(); };
    },
  };

  window.BNW = BNW;

  // 页面加载后：刷新一次积分，并把离线时攒下的成绩补交上去
  window.addEventListener('load', function () {
    BNW.refresh().catch(function () {});
    setTimeout(function () { flushQueue(); }, 1500);
  });
})();
