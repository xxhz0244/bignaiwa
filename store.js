// 极简持久化层：内存为真相 + JSON 原子落盘。
// 数据量（校内几千人、几万条成绩）用 JSON 完全够，零依赖、零编译。
// 以后想换 MySQL/SQLite，只需替换本文件的 load() / save() 与 db 的读写封装。

const fs = require('fs');
const path = require('path');
const CFG = require('./config');

const DATA_FILE = path.resolve(__dirname, CFG.DATA_FILE);

function emptyDb() {
  return {
    players: {},   // pid -> player
    recent: [],    // 最近成绩（滚动窗口，最多 200 条）
    seq: 0,
  };
}

let db = emptyDb();

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db = Object.assign(emptyDb(), parsed);
      console.log(`[store] 已载入数据：${Object.keys(db.players).length} 名玩家`);
    } else {
      console.log('[store] 未找到数据文件，从空库开始');
    }
  } catch (e) {
    console.error('[store] 数据文件损坏，已备份并从空库开始：', e.message);
    try {
      fs.renameSync(DATA_FILE, DATA_FILE + '.broken-' + Date.now());
    } catch (_) {}
    db = emptyDb();
  }
}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DATA_FILE); // 原子替换，避免写一半崩掉导致文件损坏
    } catch (e) {
      console.error('[store] 落盘失败：', e.message);
    }
  }, CFG.SAVE_DEBOUNCE_MS);
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

function todayStr(d = new Date()) {
  // 用北京时间算「天」，避免服务器时区导致日限错乱
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

module.exports = { db: () => db, load, save, flush, todayStr, DATA_FILE };
