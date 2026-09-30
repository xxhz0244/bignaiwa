// 接口自测： node test.js   （需先启动 node server.js）
// 覆盖：身份(uid+中文昵称)、找回、当前分/最高分、频控、异常校验、
//       书院榜「按人去重、每人取单局最高分、前 20 人求和」、管理接口、落盘
const BASE = 'http://localhost:8787';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ' + (extra ? JSON.stringify(extra) : '')); }
}

// 唯一中文昵称池（仅中文、互不相同）
const HAN = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳';
function han(i) { return HAN[i]; }

const reg = (uid, nickname, college, grade) =>
  api('POST', '/api/player', { uid, nickname, college, grade }).then((r) => r.data);
const play = (uid, score, drops, durationMs) =>
  api('POST', '/api/submit', { uid, score, drops: drops || 200, durationMs: durationMs || 300000 }).then((r) => r.data);
const nextUid = (n) => String(100000 + n); // 6 位数字，唯一

(async () => {
  console.log('== 1. 注册与身份 ==');
  const a = await reg(nextUid(1), '奶娃小王', '乐育', '大三');
  check('注册返回 uid', !!a.uid, a);
  check('书院正确', a.college === '乐育', a);
  check('昵称正确', a.nickname === '奶娃小王', a);
  const bad = await api('POST', '/api/player', { uid: nextUid(2), nickname: '乱填', college: '清华', grade: '大三' });
  check('非法书院被拒绝', bad.status === 400, bad.data);
  const noNick = await api('POST', '/api/player', { uid: nextUid(3), college: '乐育', grade: '大三' });
  check('不填昵称被拒', noNick.status === 400, noNick.data);
  const latin = await api('POST', '/api/player', { uid: nextUid(4), nickname: 'abc12', college: '乐育', grade: '大三' });
  check('含非中文的昵称被拒', latin.status === 400, latin.data);

  console.log('== 2. 专属 ID 必须是 6 位数字 ==');
  const u4 = await api('POST', '/api/player', { uid: '6688', nickname: '短号', college: '乐育', grade: '大三' });
  check('4 位被拒', u4.status === 400, u4.data);
  const ustr = await api('POST', '/api/player', { uid: 'abcdef', nickname: '字母', college: '乐育', grade: '大三' });
  check('非数字被拒', ustr.status === 400, ustr.data);
  const u7 = await api('POST', '/api/player', { uid: '6688666', nickname: '七位', college: '乐育', grade: '大三' });
  check('7 位被拒', u7.status === 400, u7.data);

  console.log('== 3. 昵称规则：唯一且不可改 ==');
  const dup = await api('POST', '/api/player', { uid: nextUid(5), nickname: '奶娃小王', college: '乐育', grade: '大一' });
  check('重复昵称被拒(409)', dup.status === 409, dup.data);
  const change = await api('POST', '/api/player', { uid: a.uid, nickname: '想改名', college: '乐育', grade: '大三' });
  check('已存在账号改昵称被拒(409)', change.status === 409, change.data);
  const sameOk = await api('POST', '/api/player', { uid: a.uid, nickname: '奶娃小王', college: '弘文', grade: '大四' });
  check('同 uid 改书院/年级成功', sameOk.data.ok && sameOk.data.college === '弘文', sameOk.data);

  console.log('== 4. 换设备用专属 ID 找回 ==');
  const claim = await api('POST', '/api/claim', { uid: a.uid });
  check('专属 ID 找回成功', claim.data.ok && claim.data.uid === a.uid, claim.data);
  const wrong = await api('POST', '/api/claim', { uid: '999999' });
  check('不存在的 ID 找不到', wrong.status === 404, wrong.data);

  console.log('== 5. 个人当前分 / 最高分 ==');
  const s1 = await play(a.uid, 3200);
  check('首局：当前分=3200', s1.ok && s1.lastScore === 3200, s1);
  check('首局：最高分=3200', s1.bestScore === 3200, s1);
  const s2 = await api('POST', '/api/submit', { uid: a.uid, score: 1000, drops: 20, durationMs: 40000 });
  check('3 秒内重复提交被频控拦截', s2.status === 429, s2.data);
  await sleep(3100);
  const s3 = await play(a.uid, 1000);
  check('再玩一局：当前分刷新为 1000', s3.ok && s3.lastScore === 1000, s3);
  check('最高分仍为 3200（取历史最大）', s3.bestScore === 3200, s3);

  console.log('== 6. 异常提交校验 ==');
  await sleep(3100); // 先过频控，才能测到参数校验
  const s4 = await api('POST', '/api/submit', { uid: a.uid, score: 99999, drops: 5, durationMs: 8000 });
  check('分数与投放次数不匹配被拒', s4.status === 400, s4.data);
  const s5 = await api('POST', '/api/submit', { uid: a.uid, score: 500, drops: 10, durationMs: 800 });
  check('时长过短被拒', s5.status === 400, s5.data);

  console.log('== 7. 同一人只取单局最高分，只占一个坑 ==');
  const x = await reg(nextUid(10), '知行独苗', '知行', '大二');
  await play(x.uid, 9000); await sleep(3100);
  await play(x.uid, 8000); await sleep(3100);
  await play(x.uid, 7000);
  const zx = (await api('GET', '/api/leaderboard/college?college=' + encodeURIComponent('知行'))).data;
  console.log('  知行明细：', zx.entries.map((e) => e.rank + ':' + e.nickname + ':' + e.score).join('  '));
  check('同一人只占 1 个坑（取最高分）', zx.entries.length === 1, zx.entries);
  check('最高分是 9000', zx.entries[0].score === 9000, zx.entries);
  check('书院合计 = 该人最高分', zx.total === 9000, zx.total);

  console.log('== 8. 书院榜：前 20 人各取最高分求和 ==');
  const grades = ['大一', '大二', '大三', '大四'];
  for (let i = 0; i < 25; i++) {
    const p = await reg(nextUid(20 + i), han(i), '乐育', grades[i % 4]);
    await play(p.uid, 10000 - i * 100);
  }
  for (let i = 0; i < 8; i++) {
    const p = await reg(nextUid(50 + i), han(25 + i), '会同', grades[i % 4]);
    await play(p.uid, 8000 - i * 50);
  }
  const board = (await api('GET', '/api/leaderboard/colleges')).data;
  console.log('  书院榜：');
  for (const c of board.board) {
    console.log(`    ${c.college}  总分 ${c.total}  计入 ${c.counted} 人 / ${c.players} 人`);
  }
  const ly = board.board.find((c) => c.college === '乐育');
  const ht = board.board.find((c) => c.college === '会同');
  check('乐育只取前 20 人', ly.counted === 20, ly);
  check('会同不足 20 人时全部计入', ht.counted === Math.min(20, ht.players), ht);
  const expectLy = Array.from({ length: 20 }, (_, i) => 10000 - i * 100).reduce((s, v) => s + v, 0);
  check('乐育总分 = 前 20 人最高分之和', ly.total === expectLy, { got: ly.total, expectLy });
  check('书院榜按总分降序', board.board[0].total >= board.board[1].total, board.board.map((c) => c.total));
  check('书院榜带明细 entries', ly.entries.length === 20 && typeof ly.entries[0].score === 'number', ly.entries[0]);

  console.log('== 9. 管理接口 ==');
  const noToken = await api('GET', '/api/admin/export?token=wrong');
  check('错误口令被拒', noToken.status === 403, noToken.data);
  const drop = await api('POST', '/api/admin/drop-score', { token: 'change-me-please', college: '知行', uid: x.uid });
  check('可按 uid 删掉某人的全部成绩', drop.data.ok && drop.data.removedCount >= 1, drop.data);
  const zx2 = (await api('GET', '/api/leaderboard/college?college=' + encodeURIComponent('知行'))).data;
  check('删除后该人榜单为空', zx2.entries.length === 0, zx2);

  console.log('== 10. 统计与落盘 ==');
  const st = (await api('GET', '/api/stats')).data;
  console.log('  统计：', JSON.stringify(st));
  check('统计含各书院人数与总分', st.byCollege['乐育'].players >= 25 && st.byCollege['乐育'].topTotal === expectLy, st.byCollege);

  await sleep(1200);
  const fs = require('fs');
  const db = JSON.parse(fs.readFileSync('./data/db.json', 'utf8'));
  check('数据已落盘', Object.keys(db.players).length > 30, Object.keys(db.players).length);
  check('书院榜单数据已落盘', db.collegeTop && db.collegeTop['乐育'].length >= 20, db.collegeTop && Object.keys(db.collegeTop));

  console.log(`\n结果： ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
