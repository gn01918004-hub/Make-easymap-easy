// node tests/run.js   （需要 playwright 與 openlayers@3.20.1；OL_JS 可指定 ol.js 路徑）
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok  ' + name); });

(async () => {
  // ---- 純邏輯 ----
  const h = require(path.join(root, 'src/easymap-helper.js'));
  await ok('點號正規化', () => {
    assert.equal(h.norm(' ００7 '), '7'); assert.equal(h.norm('a12'), 'A12');
    assert.equal(h.normLand('0012-0000'), '12'); assert.equal(h.normLand('12-3'), '12-3'); assert.equal(h.normLand('0012-0003'), '12-3');
  });
  await ok('句點、空白、中文間隔號都能分隔點號', () => {
    const known = {}; ['3411','3412','3413','5','6','7'].forEach(k => known[k] = 1);
    assert.deepEqual(h.parsePoints('3411.3412 3413', known).list, ['3411','3412','3413']);
    assert.deepEqual(h.parsePoints('3411．3412‧3413·5・6', known).list, ['3411','3412','3413','5','6']);
    assert.deepEqual(h.parsePoints('5-7.3411', known).list, ['5','6','7','3411']);
  });
  await ok('點號展開與找不到的點', () => {
    const known = {}; ['1','2','3','5','6','7','8','A1'].forEach(k => known[k] = 1);
    const r = h.parsePoints('1、2 ,5-7\n a1 9 3~4', known);
    assert.deepEqual(r.list, ['1','2','5','6','7','A1','3']); assert.deepEqual(r.missing, ['9','4']);
  });

  // ---- 模擬頁面 ----
  const olJs = process.env.OL_JS || require.resolve('openlayers/dist/ol.js');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'emh-'));
  fs.writeFileSync(path.join(tmp, 'mock.html'), fs.readFileSync(path.join(__dirname, 'mock.html'), 'utf8').replace('OL_JS', 'ol.js'));
  fs.copyFileSync(olJs, path.join(tmp, 'ol.js'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {});
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.join(tmp, 'mock.html'));
  const src = fs.readFileSync(path.join(root, 'src/easymap-helper.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'dist/安裝說明.html'), 'utf8');
  const out = async () => (await page.textContent('#emh-warn')) + '\n' + (await page.getAttribute('#emh-out', 'data-text'));

  await ok('安裝頁的書籤內容可執行、面板出現、自動帶入申請地號', async () => {
    const href = /id="bm" href="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"');
    assert.ok(href.startsWith('javascript:'));
    await page.evaluate(decodeURIComponent(href.slice('javascript:'.length)));
    assert.equal(await page.inputValue('#emh-lands'), '10');
    assert.match(await page.textContent('#emh-ver'), /^v\d+\.\d+$/);
    assert.match(await page.textContent('#emh-panel'), /共 6 個界址點，目前勾選 0 個/);
  });
  await ok('勾選點號並重新計算', async () => {
    await page.fill('#emh-points', '1, 2 5-6 99');
    await page.click('#emh-apply');
    const st = await page.evaluate(() => ({ sp: send_point, recalc, styleLog }));
    assert.deepEqual(st.sp, ['1','2','5','6']); assert.equal(st.recalc, 1);
    assert.equal(st.styleLog['1'], 'on'); assert.equal(st.styleLog['3'], 'off');
    assert.match(await page.textContent('#emh-warn'), /圖上沒有這些點號（可能輸錯），未勾選：99/);
    assert.equal(await page.locator('#emh-out .emh-chip').count(), 4);
    assert.ok(await page.isVisible('#emh-warn'));
  });
  await ok('單筆申請地號的鄰地（含邊中間碰到的 21）', async () => {
    const t = await out();
    assert.match(t, /鄰地共 4 筆：11、20、21、22-1/);
    assert.match(t, /11：2、5/); assert.match(t, /20：1、6/); assert.match(t, /21：5/); assert.match(t, /22-1：6/);
    assert.doesNotMatch(t, /30/);
  });
  await ok('多筆申請地號：兩筆之間的點不算鄰地', async () => {
    await page.fill('#emh-lands', '10、0011');
    await page.fill('#emh-points', '1-6');
    await page.click('#emh-apply');
    const t = await out();
    assert.match(t, /鄰地共 3 筆：20、21、22-1/);
    assert.equal(await page.evaluate(() => send_point.length), 6);
  });
  await ok('照目前手動勾選列鄰地、不重新計算', async () => {
    const before = await page.evaluate(() => { send_point = ['3', '4']; return recalc; });
    await page.click('#emh-list');
    assert.match(await out(), /鄰地共 0 筆/);
    assert.equal(await page.evaluate(() => recalc), before);
  });
  await ok('打錯申請地號與沒碰到申請地的點會提醒', async () => {
    await page.fill('#emh-lands', '10,999');
    await page.click('#emh-list');
    const t = await out();
    assert.match(t, /圖上找不到這些申請地號：999/); assert.match(t, /沒有碰到任何申請地號，未列入：3、4/);
  });
  await ok('全部輸錯：醒目提醒、圖上勾選不變', async () => {
    await page.fill('#emh-lands', '10');
    const before = await page.evaluate(() => { send_point = ['1']; return recalc; });
    await page.fill('#emh-points', '77 88');
    await page.click('#emh-apply');
    assert.match(await page.textContent('#emh-warn'), /圖上沒有這些點號（可能輸錯）：77、88/);
    assert.deepEqual(await page.evaluate(() => send_point), ['1']);
    assert.equal(await page.evaluate(() => recalc), before);
    await page.fill('#emh-points', '1,2');
    await page.click('#emh-apply');
    assert.ok(!(await page.isVisible('#emh-warn')));
  });
  await ok('列印圖說：擠在一起的點，點號互不重疊；含鄰地清冊；可關閉', async () => {
    await page.evaluate(() => {   // 在 (10,10) 附近加一群很近的點
      [['51',10.2,10],['52',9.8,9.9],['53',10,9.7],['54',10.3,10.2],['55',0.2,10]].forEach(a => Cadastral_source.addFeature(pt(a[0],a[1],a[2])));
    });
    await page.fill('#emh-points', '1,2,5,6,51-55,99');
    await page.click('#emh-apply');
    await page.click('#emh-print-btn');
    const info = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('#emh-print svg text.emh-pl')].map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; });
      let hit = [];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hit.push(a.t + '/' + b.t);
      }
      return { n: bs.length, hit, text: document.getElementById('emh-print').textContent, lands: [...document.querySelectorAll('#emh-print svg text.emh-ll')].map(e => e.textContent) };
    });
    assert.equal(info.n, 9);  // 點 3、4 在圖框外 assert.deepEqual(info.hit, []);
    assert.match(info.text, /鑑界界址點及鄰地圖說/); assert.match(info.text, /鄰地清冊（共 4 筆）/); assert.doesNotMatch(info.text, /點位對照/);
    assert.match(info.text, /1\s*11\s*2、5、53/); assert.match(info.text, /4\s*22-1\s*6、55/);
    assert.match(info.text, /圖上沒有這些點號（可能輸錯），未勾選：99/);
    ['10', '11', '20', '21', '22-1'].forEach(l => assert.ok(info.lands.includes(l), l));
    if (process.env.SHOT) { await page.emulateMedia({ media: 'print' }); await page.pdf({ path: process.env.SHOT, format: 'A4' }); await page.emulateMedia({ media: 'screen' }); }
    await page.click('#emh-closeprint');
    assert.equal(await page.locator('#emh-print').count(), 0);
  });
  await ok('打字時就提示將勾選幾點、哪些點號圖上沒有', async () => {
    await page.fill('#emh-points', '1.2 5 77');
    assert.match(await page.textContent('#emh-live'), /將勾選 3 點\s*圖上沒有：77/);
    await page.fill('#emh-points', '');
    assert.equal(await page.textContent('#emh-live'), '');
  });
  await ok('縮小／展開面板', async () => {
    await page.click('#emh-min');
    assert.ok(!(await page.isVisible('#emh-points')));
    await page.click('#emh-min');
    assert.ok(await page.isVisible('#emh-points'));
  });
  await ok('安裝頁書籤名稱有圖示', () => {
    assert.match(html, /id="bm" href="[^"]+">📍鑑界小幫手<\/a>/);
  });
  await ok('同一件案子：手動改的申請地號不會被蓋掉', async () => {
    await page.fill('#emh-lands', '10,11');
    await page.waitForTimeout(1300);
    assert.equal(await page.inputValue('#emh-lands'), '10,11');
  });
  await ok('換案子時自動更新申請地號、清掉上一件的點號與結果', async () => {
    await page.fill('#emh-lands', '10');
    await page.fill('#emh-points', '1,2');
    await page.click('#emh-apply');
    await page.evaluate(() => {   // 模擬在原網頁查了另一件（兩筆申請地號）
      map_Cadastral_source.clear(); Cadastral_source.clear(); send_point = [];
      map_Cadastral_source.addFeatures([poly('333', true, [[0,0],[10,0],[10,10],[0,10]]), poly('334', true, [[10,0],[20,0],[20,10],[10,10]]),
        poly('335', false, [[0,10],[20,10],[20,20],[0,20]])]);
      Cadastral_source.addFeatures([pt('1460',0,10), pt('1461',10,10), pt('1462',20,10)]);
    });
    await page.waitForFunction(() => document.getElementById('emh-lands').value === '333,334', null, { timeout: 3000 });
    assert.equal(await page.inputValue('#emh-points'), '');
    assert.match(await page.textContent('#emh-out'), /已換成新的案子，申請地號自動更新為：333、334/);
    assert.match(await page.textContent('.emh-info'), /本頁共 3 個界址點，目前勾選 0 個/);
    await page.fill('#emh-points', '1460.1461 1462');
    await page.click('#emh-apply');
    assert.match(await out(), /鄰地共 1 筆：335/);
  });
  await ok('點很多的案子（39 點、7 筆申請地）：點號排在四周，不重疊、不壓點、引線不交叉，清冊印在第 2 頁', async () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dense.json'), 'utf8'));
    await page.evaluate(d => loadCase(d), data);
    await page.waitForFunction(n => document.getElementById('emh-lands').value.split(',').length === n, data.parcels.filter(x => x.mine).length, { timeout: 3000 });
    await page.fill('#emh-points', data.points.filter(x => x.sel).map(x => x.no).join(' '));
    await page.click('#emh-apply');
    assert.match(await out(), /鄰地共 12 筆/);
    await page.click('#emh-print-btn');
    const m = await page.evaluate(() => {
      const f = window.__easymapHelperFig;
      const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const seg = (a, b, c, d) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
      let lab = 0, dot = 0, cross = 0, out = 0;
      f.labels.forEach((a, i) => {
        f.labels.forEach((b, j) => { if (i < j && hit(a, b)) lab++; });
        f.dots.forEach(d => { if (hit(a, { x: d[0] - 6, y: d[1] - 6, w: 12, h: 12 })) dot++; });
        if (a.x < 0 || a.y < 0 || a.x + a.w > f.W || a.y + a.h > f.H) out++;
      });
      f.leaders.forEach((a, i) => f.leaders.forEach((b, j) => { if (i < j && seg(a[0], a[1], b[0], b[1])) cross++; }));
      const pl = [...document.querySelectorAll('#emh-print svg text.emh-pl')].length;
      const ll = [...document.querySelectorAll('#emh-print svg text.emh-ll')].map(e => e.textContent);
      const h2 = [...document.querySelectorAll('#emh-print h2')].find(e => /鄰地清冊/.test(e.textContent));
      return { dense: f.dense, n: f.labels.length, pl, lab, dot, cross, out, ll, brk: h2.style.breakBefore };
    });
    assert.ok(m.dense);
    assert.equal(m.n, 39); assert.equal(m.pl, 39);   // 只標鑑界點，沒選的點不標號
    assert.deepEqual([m.lab, m.dot, m.cross, m.out], [0, 0, 0, 0]);
    data.parcels.forEach(x => assert.ok(m.ll.includes(x.no), x.no));
    assert.equal(m.brk, 'page');
    if (process.env.SHOT_DENSE) { await page.emulateMedia({ media: 'print' }); await page.pdf({ path: process.env.SHOT_DENSE, format: 'A4' }); await page.emulateMedia({ media: 'screen' }); }
    await page.click('#emh-closeprint');
  });
  await ok('重按書籤不會出現兩個面板；還沒查詢時有提示', async () => {
    await page.evaluate(src);
    assert.equal(await page.locator('#emh-panel').count(), 1);
    await page.evaluate(() => { Cadastral_source.clear(); });
    await page.evaluate(src);
    assert.match(await page.textContent('#emh-panel'), /還沒有圖資/);
  });
  await ok('檢查資訊可產生', async () => {
    const ctx = browser.contexts()[0]; await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('#emh-diag');
    assert.match(await page.textContent('#emh-diag'), /已複製|複製檢查資訊/);
  });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(n + ' tests passed');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
