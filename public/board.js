// BigNaiWa 积分系统 · 游戏集成模块
// 职责：
//   1. 游戏结束时提交成绩到后端（window.DanaiwaBoard.onGameOver）
//   2. 启动 / 换设备时用专属 ID 注册或找回身份
//   3. 渲染「书院榜」弹窗（书院总分 + 每个书院前 20 名）
// 依赖： backend.js（提供 window.BNW）

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }

  // ── 1. 身份：首次进入必须设置专属 ID ──────────────────
  function ensureIdentity() {
    if (window.BNW && BNW.hasIdentity()) return Promise.resolve(BNW.me());
    return BNW.showIdentityPicker().catch(function () { return null; });
  }

  // 页面加载即要求设置身份（ID 必填）
  if (window.BNW && !BNW.hasIdentity()) {
    BNW.showIdentityPicker().catch(function () {});
  }

  // ── 2. 游戏结束：提交成绩 ────────────────────────────
  function updateSubmitBox(html, retry) {
    var box = $('submitBox');
    var msg = $('submitMsg');
    if (!box || !msg) return;
    msg.innerHTML = html;
    var btn = $('submitBtn');
    if (btn) btn.hidden = !retry;
  }

  var lastPayload = null;
  window.DanaiwaBoard = {
    onGameOver: function (payload) {
      lastPayload = payload;
      var me = BNW.me();
      if (me) {
        var nameEl = $('myNameLabel');
        if (nameEl) nameEl.textContent = me.nickname || '匿名';
      }
      // 没身份先弹设置
      if (!BNW.hasIdentity()) {
        updateSubmitBox('正在设置身份…', false);
        ensureIdentity().then(function (p) {
          if (!p) { updateSubmitBox('请先设置专属 ID 再参与积分', false); return; }
          doSubmit(payload);
        });
        return;
      }
      doSubmit(payload);
    },
  };

  function doSubmit(payload) {
    updateSubmitBox('正在结算…', false);
    BNW.submit(payload).then(function (r) {
      var html =
        '本局 <strong>' + payload.score + '</strong> 分　当前分 <strong>' + r.lastScore + '</strong>' +
        '　最高分 <strong>' + r.bestScore + '</strong>　书院第 <strong>' + r.collegeRank + '</strong> 名';
      updateSubmitBox(html, false);
    }).catch(function (e) {
      if (e.queued) {
        updateSubmitBox('网络异常，已暂存，联网后自动补交 ✓', true);
      } else if (e.status === 429) {
        updateSubmitBox('手速太快，请稍后再提交（可重试）', true);
      } else if (e.status === 400) {
        updateSubmitBox('本局成绩未计入：' + e.message, false);
      } else {
        updateSubmitBox('提交失败：' + e.message, true);
      }
    });
  }

  // 重试提交
  var sb = $('submitBtn');
  if (sb) sb.addEventListener('click', function () { if (lastPayload) doSubmit(lastPayload); });

  // 改名按钮已无意义（昵称不可改），隐藏
  var enb = $('editNameBtn');
  if (enb) enb.hidden = true;

  // ── 3. 书院榜弹窗 ────────────────────────────────────
  var modal = $('boardModal');
  var body = $('boardBody');

  function openBoard() { if (modal) { modal.setAttribute('aria-hidden', 'false'); modal.classList.add('show'); renderBoard(); } }
  function closeBoard() { if (modal) { modal.setAttribute('aria-hidden', 'true'); modal.classList.remove('show'); } }

  function renderBoard() {
    if (!body) return;
    body.innerHTML = '<div class="empty">加载中…</div>';
    Promise.all([BNW.collegeBoard(), BNW.me() ? BNW.refresh().catch(function () { return null; }) : Promise.resolve(null)])
      .then(function (arr) {
        var data = arr[0];
        var me = arr[1] || BNW.me();
        var html = '';

        // 我的卡片
        if (me) {
          html += '<div class="bnw-me">' +
            '<div class="bnw-me-row"><span>昵称</span><strong>' + escapeHtml(me.nickname) + '</strong></div>' +
            '<div class="bnw-me-row"><span>书院 / 年级</span><strong>' + escapeHtml(me.college + ' · ' + me.grade) + '</strong></div>' +
            '<div class="bnw-me-row"><span>当前分</span><strong>' + (me.lastScore || 0) + '</strong></div>' +
            '<div class="bnw-me-row"><span>我的最高分</span><strong>' + (me.bestScore || 0) + '</strong></div>' +
            '<div class="bnw-me-row"><span>书院内排名</span><strong>第 ' + (me.collegeRank || '-') + ' 名 / ' + (me.collegeTotal || 0) + ' 人</strong></div>' +
            '</div>';
        }

        // 书院总分榜
        html += '<h3 class="bnw-sub">书院总分榜</h3><div class="bnw-totals">';
        data.board.forEach(function (c, i) {
          html += '<div class="bnw-total-row' + (me && me.college === c.college ? ' mine' : '') + '">' +
            '<span class="bnw-rank">' + (i + 1) + '</span>' +
            '<span class="bnw-name">' + escapeHtml(c.college) + '</span>' +
            '<span class="bnw-score">' + c.total + '</span>' +
            '<span class="bnw-sub2">计入 ' + c.counted + '/' + c.players + ' 人</span>' +
            '</div>';
        });
        html += '</div>';

        // 分院标签页
        html += '<h3 class="bnw-sub">各书院前 ' + data.topN + ' 名（按单局最高分）</h3>';
        html += '<div class="bnw-tabs" id="bnwTabs">';
        data.board.forEach(function (c, i) {
          html += '<button class="bnw-tab' + (i === 0 ? ' active' : '') + '" data-college="' + escapeHtml(c.college) + '">' + escapeHtml(c.college) + '</button>';
        });
        html += '</div>';
        html += '<div id="bnwTabBody"></div>';

        body.innerHTML = html;

        // 标签切换
        var tabs = body.querySelectorAll('.bnw-tab');
        tabs.forEach(function (t) {
          t.addEventListener('click', function () {
            tabs.forEach(function (x) { x.classList.remove('active'); });
            t.classList.add('active');
            renderCollege(t.getAttribute('data-college'), me);
          });
        });
        // 默认渲染第一个书院
        if (data.board[0]) renderCollege(data.board[0].college, me);
      }).catch(function () {
        body.innerHTML = '<div class="empty">榜单加载失败，请稍后刷新</div>';
      });
  }

  function renderCollege(college, me) {
    var tb = $('bnwTabBody');
    if (!tb) return;
    tb.innerHTML = '<div class="empty">加载中…</div>';
    BNW.collegeDetail(college).then(function (d) {
      var html = '<div class="bnw-detail-head"><span>' + escapeHtml(college) + ' 总分 <strong>' + d.total + '</strong>　计入 ' + d.counted + ' 人</span></div>';
      html += '<div class="bnw-detail-list">';
      d.entries.forEach(function (e) {
        var mine = me && e.uid === me.uid;
        html += '<div class="bnw-entry' + (mine ? ' mine' : '') + '">' +
          '<span class="bnw-rk">' + e.rank + '</span>' +
          '<span class="bnw-nk">' + escapeHtml(e.nickname) + (mine ? '（我）' : '') + '</span>' +
          '<span class="bnw-gr">' + escapeHtml(e.grade) + '</span>' +
          '<span class="bnw-sc">' + e.score + '</span>' +
          '<span class="bnw-tm">' + fmtTime(e.at) + '</span>' +
          '</div>';
      });
      if (!d.entries.length) html += '<div class="empty">还没有成绩，快去玩一局！</div>';
      html += '</div>';
      tb.innerHTML = html;
    }).catch(function () {
      tb.innerHTML = '<div class="empty">加载失败</div>';
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 按钮绑定
  if ($('boardBtn')) $('boardBtn').addEventListener('click', openBoard);
  if ($('boardBtn2')) $('boardBtn2').addEventListener('click', openBoard);
  if ($('boardClose')) $('boardClose').addEventListener('click', closeBoard);
  if ($('boardRefresh')) $('boardRefresh').addEventListener('click', renderBoard);
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeBoard(); });

  // 让弹窗可显示（覆盖原 CSS 里可能存在的隐藏）
  if (modal) {
    var style = document.createElement('style');
    style.textContent =
      '#boardModal.show{display:flex} ' +
      '.bnw-me{background:#f7f9fc;border:1px solid #eaeef5;border-radius:12px;padding:12px 14px;margin:10px 0} ' +
      '.bnw-me-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#444} ' +
      '.bnw-me-row strong{color:#222} ' +
      '.bnw-sub{font-size:14px;margin:14px 0 8px;color:#333} ' +
      '.bnw-totals{display:flex;flex-direction:column;gap:6px} ' +
      '.bnw-total-row{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fff;border:1px solid #eee;border-radius:10px;font-size:14px} ' +
      '.bnw-total-row.mine{border-color:#1a73e8;background:#eef4ff} ' +
      '.bnw-rank{width:22px;height:22px;line-height:22px;text-align:center;background:#1a73e8;color:#fff;border-radius:50%;font-size:12px} ' +
      '.bnw-name{flex:1;font-weight:600} ' +
      '.bnw-score{font-weight:700;color:#e65100} ' +
      '.bnw-sub2{font-size:11px;color:#999} ' +
      '.bnw-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px} ' +
      '.bnw-tab{padding:6px 12px;border:1px solid #ddd;background:#fff;border-radius:20px;font-size:13px;cursor:pointer} ' +
      '.bnw-tab.active{background:#1a73e8;border-color:#1a73e8;color:#fff} ' +
      '.bnw-detail-head{font-size:13px;color:#555;margin-bottom:6px} ' +
      '.bnw-detail-list{display:flex;flex-direction:column;gap:4px;max-height:320px;overflow:auto} ' +
      '.bnw-entry{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff;border:1px solid #f0f0f0;border-radius:8px;font-size:13px} ' +
      '.bnw-entry.mine{border-color:#1a73e8;background:#eef4ff} ' +
      '.bnw-rk{width:20px;text-align:center;color:#999} ' +
      '.bnw-nk{flex:1;font-weight:600} ' +
      '.bnw-gr{color:#888;font-size:12px} ' +
      '.bnw-sc{font-weight:700;color:#e65100} ' +
      '.bnw-tm{color:#aaa;font-size:11px;width:48px;text-align:right}';
    document.head.appendChild(style);
  }
})();
