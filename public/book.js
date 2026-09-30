/* ============================================================
 *  《捧腹大笑思想与奶龙学概论》· 站内阅读器
 *  逐页图片懒加载：一次只下载当前页（约 150KB），翻页时才取下一页，
 *  手机流量友好；用图片而非直接打开 PDF，微信内置浏览器也能正常看。
 * ============================================================ */
(function () {
  'use strict';

  var TOTAL = 20;                       // 页数（由 pdf2pages.py 生成时确定）
  var page = 1;
  var preloaded = {};
  var $ = function (id) { return document.getElementById(id); };

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function src(n) { return 'assets/book/page-' + pad(n) + '.jpg'; }

  /* 后台预取下一页，翻页时几乎无等待 */
  function preload(n) {
    if (n < 1 || n > TOTAL || preloaded[n]) return;
    preloaded[n] = true;
    var im = new Image();
    im.src = src(n);
  }

  function render() {
    var img = $('bookPage');
    var load = $('bookLoading');
    if (!img) return;

    load.style.display = 'grid';
    img.style.visibility = 'hidden';
    img.alt = '第 ' + page + ' 页';
    img.onload = function () {
      load.style.display = 'none';
      img.style.visibility = 'visible';
      preload(page + 1);
    };
    img.onerror = function () {
      load.textContent = '这一页加载失败了，翻页重试一下';
    };
    img.src = src(page);

    $('bookIndicator').textContent = page + ' / ' + TOTAL;
    $('bookPrev').disabled = page <= 1;
    $('bookNext').disabled = page >= TOTAL;
  }

  function go(n) {
    n = Math.min(Math.max(n, 1), TOTAL);
    if (n === page) return;
    page = n;
    render();
  }

  function open() {
    var m = $('bookModal');
    if (!m) return;
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
    page = 1;
    render();
  }

  function close() {
    var m = $('bookModal');
    if (!m) return;
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
  }

  function bind() {
    var btn = $('bookBtn');
    if (btn) btn.addEventListener('click', open);
    var x = $('bookClose');
    if (x) x.addEventListener('click', close);
    if ($('bookPrev')) $('bookPrev').addEventListener('click', function () { go(page - 1); });
    if ($('bookNext')) $('bookNext').addEventListener('click', function () { go(page + 1); });

    var m = $('bookModal');
    if (m) m.addEventListener('click', function (e) { if (e.target === m) close(); });

    /* 键盘：← → 翻页，Esc 关闭 */
    document.addEventListener('keydown', function (e) {
      if (!m || !m.classList.contains('show')) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowLeft') { go(page - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { go(page + 1); e.preventDefault(); }
    });

    /* 触屏左右滑动翻页 */
    var v = $('bookViewer');
    if (v) {
      var sx = 0, sy = 0;
      v.addEventListener('touchstart', function (e) {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      }, { passive: true });
      v.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - sx;
        var dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          go(dx < 0 ? page + 1 : page - 1);
        }
      }, { passive: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.DanaiwaBook = { open: open, close: close };
})();
