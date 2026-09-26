

const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

const box = { window: {}, console };
box.window = box;
box.globalThis = box;
vm.createContext(box);
vm.runInContext(read('js/sync-coverage.js'), box, { filename: 'js/sync-coverage.js' });
const C = box.SyncCoverage;

console.log('\n=== 一、总表本身：每一行都答完三个问题 ===');
chk(!!C, 'js/sync-coverage.js 加载出来了');
const rows = C.rows();
chk(rows.length >= 25, '表里有 ' + rows.length + ' 行（每一把本机键一行）');
chk(rows.every(r => r.key && typeof r.sync === 'boolean' && r.why),
  '每行都有 key / sync / why 三项');
chk(rows.every(r => r.sync ? (r.row && r.merge && r.cap) : (r.cap || r.row === '')),
  '上云的必须写清行号 + 合并规则 + 上界；不上云的必须给出理由');
chk(rows.every(r => !r.sync || r.merge), '上云的每一行都写了「多设备怎么合」');
chk(new Set(rows.map(r => r.key)).size === rows.length, '没有重复的键');

console.log('\n=== 二、源码里的每一把 poem_* 键都在表里（本次就靠它发现漏网）===');

const jsFiles = fs.readdirSync(path + 'js').filter(f => f.endsWith('.js') && f !== 'sync-coverage.js');
const found = new Set();

const IGNORE = new Set(['poem_reads', 'poem_', 'poem']);
jsFiles.forEach(f => {
  const src = read('js/' + f);

  (src.match(/["']poem_[a-z0-9_]*["']/g) || []).forEach(lit => {
    const k = lit.slice(1, -1);
    if (IGNORE.has(k)) return;
    found.add(k);
  });
});
const missing = [...found].filter(k => !C.known(k));
eq(missing.join(','), '', '没有「表外」的键（漏一个就在这一条上红）');
chk(found.size >= 20, '扫出来 ' + found.size + ' 把键（太少说明扫描规则失效了）');

const allLits = new Set();
jsFiles.forEach(f => {
  const src = read('js/' + f);
  (src.match(/["'][a-z][a-z0-9_]*_v\d+["']/g) || []).forEach(lit => allLits.add(lit.slice(1, -1)));
});
const notInTable = [...allLits].filter(k => !C.known(k));
eq(notInTable.join(','), '', '所有 `*_v1` 形状的键都在表里（不分前缀）');

chk(C.known('poem_classic_words_'), '前缀族 `poem_classic_words_<版本>` 在表里有自己的一行');
chk(C.known('poem_plan_'), '前缀族 `poem_plan_<日期>_…` 在表里有自己的一行');
chk(!C.synced('poem_classic_words_') && !C.synced('poem_plan_'), '这两族不上云');
chk(/sessionStorage/i.test(C.row('poem_plan_').why),
  '今日计划的缓存那一条如实写明它在 sessionStorage（不是 localStorage）');

console.log('\n=== 三、表与 ProgressStore.scopes() 不许打架 ===');
const sb = { window: {}, console };
sb.window = sb;
sb.globalThis = sb;
const mem = {};
sb.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
vm.createContext(sb);
vm.runInContext(read('js/progress-store.js'), sb, { filename: 'js/progress-store.js' });
const PS = sb.ProgressStore;

rows.forEach(r => {
  if (r.key.indexOf('*') >= 0 || r.key.indexOf('_read_v1') > 0) return;
  const sc = PS.scopes().filter(s => s.key === r.key)[0];
  if (!sc) return;
  if (r.sync) chk(sc.local === false, r.key + '：表说上云，scopes() 也是 local:false');
  else chk(sc.local === true, r.key + '：表说不上云，scopes() 也是 local:true');
});

chk(PS.scopes().some(s => s.key === 'poem_recite_collections_v1' && s.local === false),
  '自选集合进了分域表且 local:false（不再被 family.js 按名字猜）');
chk(PS.scopes().some(s => s.key === 'poem_daily_extra_v1' && s.local === false),
  '今日加背在分域表里也是 local:false');
chk(PS.isReadKey('poem_tangshi_read_v1') && !PS.isReadKey('poem_daily_extra_v1'),
  '已读那一族有前缀规则可判（six 部集子不用逐个登记）');
eq(PS.isLocalKey('poem_tangshi_read_v1'), false, '已读键算「上云那一档」');
eq(PS.isLocalKey('poem_font_v1'), true, '字号键仍算设备域');

console.log('\n=== 四、行号在客户端与服务端逐字一致 ===');
const core = read('api/_lib/core.js');
const syncSrc = read('js/sync-store.js');
const colSrc = read('js/collections.js');
const readSyncSrc = read('js/read-sync.js');
const extraSrc = read('js/daily-extra.js');

chk(/COLLECTIONS_ROW_ID = "collections:v1"/.test(core), '服务端认得 collections:v1');
chk(/COLLECTIONS_ROW_ID = "collections:v1"/.test(syncSrc), 'sync-store 也认得它');
chk(/READ_ROW_PREFIX = "reads:"/.test(core) && /PREFIX = "reads:"/.test(readSyncSrc),
  '已读那一族的行号前缀两端一致（reads:）');
chk(/DAILY_EXTRA_ROW_ID = "daily_extra:v1"/.test(core) &&
  /SYNC_ID = "daily_extra:v1"/.test(extraSrc), '今日加背的行号两端一致');
chk(/FAMILY_ROW_ID = "family:v1"/.test(core) && /FAMILY_ROW_ID = "family:v1"/.test(syncSrc),
  '名册的行号两端一致');

console.log('\n=== 五、服务端白名单真的在裁 ===');
const coreMod = require(path + 'api/_lib/core.js');
chk(!!coreMod.sanitizeCollections, '服务端有 sanitizeCollections');
chk(!!coreMod.sanitizeReads, '服务端有 sanitizeReads');
eq(coreMod.COLLECTIONS_ROW_ID, 'collections:v1', '常量导出');
eq(coreMod.READ_ROW_PREFIX, 'reads:', '已读前缀导出');
eq(coreMod.readRowKeyOf('reads:poem_tangshi_read_v1'), true, '认得出已读那一族的行号');
eq(coreMod.readRowKeyOf('reads:'), false, '空后缀不算（那是脏行号）');
eq(coreMod.readRowKeyOf(undefined), false, '缺参数不抛（曾经在这里抛过）');

const bigCol = coreMod.sanitizeCollections({
  collections: [{ id: 'c1', name: '我要背的', createdAt: 1, items: new Array(600).fill(null).map((_, i) => ({ id: 'p-' + i })) }]
});
eq(bigCol.collections.length, 0,
  '每集合超 500 篇的那一条**整条丢掉**（截一半比丢掉更坏：用户看到「少了几篇」）');
eq(coreMod.sanitizeCollections({
  collections: [{ id: 'c1', name: 'x', createdAt: 1, items: new Array(500).fill(null).map((_, i) => ({ id: 'p-' + i })) }]
}).collections[0].items.length, 500, '正好 500 篇留着（上界是闭区间）');

const manyCols = coreMod.sanitizeCollections({
  collections: new Array(6000).fill(null).map((_, i) => ({ id: 'c-' + i, name: 'x', createdAt: 1, items: [] }))
});
eq(manyCols.collections.length, coreMod.COLLECTIONS_MAX, '集合数封顶 ' + coreMod.COLLECTIONS_MAX);

const colSnap = coreMod.sanitizeCollections({
  collections: [{
    id: 'c1', name: 'n'.repeat(200), createdAt: 1,
    items: [{ id: 'p1', snap: { title: 't', text: 'x'.repeat(30000), email: '泄露@example.com' } }]
  }]
});
eq(colSnap.collections.length, 1, '一个集合进来了');
eq(colSnap.collections[0].name.length, 40, '集合名截到 40 字');
eq(colSnap.collections[0].items[0].snap.text.length, 20000, '正文截到 20000 字');
chk(!('email' in colSnap.collections[0].items[0].snap), '快照里只留白名单字段（邮箱被丢掉）');

const reads = coreMod.sanitizeReads({
  marks: { 'p1': { at: 1, times: 2 }, '': { at: 1 }, 'p2': 'dirty' }
});
eq(Object.keys(reads.marks).length, 2, '空 id 丢掉，脏值收成薄记录');
eq(reads.marks.p2.at, 0, '脏值不编假时间戳（回 0）');
const manyReads = coreMod.sanitizeReads({
  marks: Object.fromEntries(new Array(3000).fill(null).map((_, i) => ['p' + i, { at: 1, times: 1 }]))
});
eq(Object.keys(manyReads.marks).length, coreMod.READ_ROW_MAX, '已读每行封顶 ' + coreMod.READ_ROW_MAX);

console.log('\n=== 六、客户端推出来的行，服务端认 ===');

const readBox = { window: {}, console };
readBox.window = readBox;
readBox.globalThis = readBox;
const mem2 = {};
readBox.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem2, k) ? mem2[k] : null),
  setItem: (k, v) => { mem2[k] = String(v); },
  removeItem: k => { delete mem2[k]; }
};
vm.createContext(readBox);
vm.runInContext(read('js/progress-store.js'), readBox, { filename: 'js/progress-store.js' });
vm.runInContext(read('js/read-sync.js'), readBox, { filename: 'js/read-sync.js' });
const R = readBox.ReadSync;
readBox.ProgressStore.setRead('poem_tangshi_read_v1', 'ts-1', true);
const rrow = R.cloudRow('poem_tangshi_read_v1', {});
chk(!!rrow, '已读推得出一行');
const cleaned = coreMod.sanitizePayload(rrow.payload, rrow.id);
eq(Object.keys(cleaned.marks).length, 1, '服务端洗完仍留着那一篇（行号认得出来）');
chk('ts-1' in cleaned.marks, '那一篇在（times 归 0 是引擎的 `setRead` 本来就写 0 —— 它只记「读过没有」）');
chk(coreMod.readRowKeyOf(rrow.id), '服务端认这个行号（不认就是白推）');
chk(!!coreMod.sanitizeCollections(rrow.payload), '「认得出来」= 走的是自己的白名单那一条分支');

console.log('\n=== 七、不上云的那几样逐条给出理由 ===');
const deviceKeys = ['poem_font_v1', 'poem_align_v1', 'poem_classic_font_v1',
  'poem_classic_align_v1', 'poem_helper_pinyin_v1', 'poem_play_mode_v1'];
deviceKeys.forEach(k => {
  const r = C.row(k);
  chk(r && !r.sync, k + '：不上云');
  chk(r && /设备偏好/.test(r.cap), k + '：理由是「设备偏好」那一类（不许留空）');
});
chk(C.row('poem_avatar_local_v1').sync, '头像字节：上云（走 Storage，不走同步载荷）');
chk(/撑爆 jsonb|1 MB/.test(C.row('poem_avatar_local_v1').cap),
  '头像那一条如实写明「体积太大」是它唯一的例外（与用户的话对上）');
chk(/服务端下发/.test(C.row('poem_auth_v1').cap), '会话不上云的理由：它本来就是服务端下发的');
chk(/同步到哪/.test(C.row('poem_sync_seen_v1').cap), '记账表不上云的理由：它说的是「这台设备同步到哪」');

console.log('\n=== 八、同步层真的照顾到了每一族（两个方向都要）===');
chk(/collectionsRow\(seen\)/.test(syncSrc), '推送时把自选集合算进去');
chk(/applyRemoteCollections/.test(syncSrc), '拉取时单独处理自选集合');
chk(/readRows\(seen\)/.test(syncSrc), '推送时把已读算进去');
chk(/applyRemoteReads/.test(syncSrc), '拉取时单独处理已读');
chk(/R\.touch\(W\.readStore\)/.test(read('js/reader-core.js')),
  '读完一篇会把那一把已读键盖一章时间戳并发起推送');
chk(/markReadSynced/.test(read('js/reader-core.js')), '上面那两步收在一个具名函数里');

chk(/markSeen\(rowId \+ "__at", t\)/.test(readSyncSrc),
  '已读的时间戳存在 seen 里（塞进 map 会被当成一篇叫 __at 的诗）');
chk(/stampOf/.test(readSyncSrc), '读回那个时间戳有具名入口');

console.log('');
console.log(fails === 0 ? '🎉 同步边界总表测试全部通过' : '❌ 同步边界总表测试 ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
