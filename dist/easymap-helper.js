/* 鑑界點位小幫手
 * 用在 https://easymap.moi.gov.tw/BSWeb/ 「鑑界複丈規費試算」查詢結果頁面。
 * 1. 輸入點號 → 自動勾選界址點（並按「重新計算」）
 * 2. 依目前勾選的點，列出碰到的鄰地地號
 *
 * 頁面上的資料（由該網站自己的程式建立）：
 *   Cadastral_source      界址點圖層，點號在 ATTR
 *   map_Cadastral_source  地籍圖層，地號在 ATTR，查詢的地號 COLOR == 'true'
 *   send_point            目前勾選的點號清單
 *   reCalData(true)       重新計算規費
 */
(function () {
  'use strict';
  var VERSION = '1.0';
  var PANEL_ID = 'emh-panel';
  var TOL_M = 0.10;   // 點到地界在 10 公分內視為「碰到」
  var WARN_M = 0.02;  // 超過 2 公分就提醒目視確認

  // ---------- 文字處理 ----------
  function norm(s) {
    s = String(s == null ? '' : s)
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/\s+/g, '').toUpperCase();
    if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, '');
    return s;
  }

  // 地號比對用：0012-0000 = 12、12-0 = 12、0012-0003 = 12-3
  function normLand(s) {
    s = norm(s);
    var m = /^(\d+)(?:-(\d+))?$/.exec(s);
    if (!m) return s;
    var a = m[1].replace(/^0+(?=\d)/, '');
    var b = m[2] ? m[2].replace(/^0+(?=\d)/, '') : '0';
    return b === '0' ? a : a + '-' + b;
  }

  function tokens(text) {
    return String(text || '')
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[～〜至到]/g, '~')
      .split(/[\s,;、，；。.\/]+/)
      .filter(function (t) { return t !== ''; });
  }

  // 把「1,2,5-8」展開；known 是頁面上實際存在的點號（已正規化）
  function parsePoints(text, known) {
    var out = [], missing = [], seen = {};
    function add(k) { if (!seen[k]) { seen[k] = 1; out.push(k); } }
    tokens(text).forEach(function (t) {
      var k = norm(t);
      if (known[k]) { add(k); return; }
      var m = /^(\d+)[-~](\d+)$/.exec(k);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { var x = a; a = b; b = x; }
        if (b - a > 5000) { missing.push(t); return; }
        for (var i = a; i <= b; i++) {
          if (known[String(i)]) add(String(i)); else missing.push(String(i));
        }
        return;
      }
      missing.push(t);
    });
    return { list: out, missing: missing };
  }

  // ---------- 幾何 ----------
  function rings(coords, out) {
    if (!coords || !coords.length) return out;
    if (typeof coords[0][0] === 'number') out.push(coords);
    else coords.forEach(function (c) { rings(c, out); });
    return out;
  }

  function distToRing(p, ring) {
    var best = Infinity;
    for (var i = 0; i + 1 < ring.length; i++) {
      var ax = ring[i][0], ay = ring[i][1], bx = ring[i + 1][0], by = ring[i + 1][1];
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var t = len2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var ex = ax + t * dx - p[0], ey = ay + t * dy - p[1];
      var d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) best = d;
    }
    return best;
  }

  // 地圖座標是 Web Mercator，換算成地面公尺要乘 cos(緯度)
  function groundScale(p) {
    var lat = (2 * Math.atan(Math.exp(p[1] / 6378137)) - Math.PI / 2);
    return Math.cos(lat);
  }

  /* points: [{no, xy}]   parcels: [{no, rings}]   applicants: {正規化地號: 1}
   * 規則：勾選的點同時碰到「申請地號」和「非申請地號」時，那筆非申請地號就是鄰地。 */
  function findNeighbors(points, parcels, applicants, tol) {
    tol = tol == null ? TOL_M : tol;
    var byLand = {}, order = [], perPoint = [], lonely = [], loose = [];
    points.forEach(function (pt) {
      var k = groundScale(pt.xy), onApp = false, others = [];
      parcels.forEach(function (pc) {
        var d = Infinity;
        pc.rings.forEach(function (r) { var x = distToRing(pt.xy, r); if (x < d) d = x; });
        d *= k;
        if (d > tol) return;
        if (applicants[normLand(pc.no)]) { onApp = true; return; }
        if (others.every(function (o) { return o.no !== pc.no; })) others.push({ no: pc.no, d: d });
      });
      if (!onApp) { lonely.push(pt.no); perPoint.push({ no: pt.no, lands: [] }); return; }
      perPoint.push({ no: pt.no, lands: others.map(function (o) { return o.no; }) });
      others.forEach(function (o) {
        if (!byLand[o.no]) { byLand[o.no] = []; order.push(o.no); }
        byLand[o.no].push(pt.no);
        if (o.d > WARN_M) loose.push({ point: pt.no, land: o.no, cm: Math.round(o.d * 100) });
      });
    });
    order.sort(landCompare);
    return { lands: order, byLand: byLand, perPoint: perPoint, lonely: lonely, loose: loose };
  }

  function landCompare(a, b) {
    var pa = normLand(a).split('-'), pb = normLand(b).split('-');
    var d = (parseInt(pa[0], 10) || 0) - (parseInt(pb[0], 10) || 0);
    if (d) return d;
    d = (parseInt(pa[1] || '0', 10) || 0) - (parseInt(pb[1] || '0', 10) || 0);
    return d || (a < b ? -1 : a > b ? 1 : 0);
  }

  // ---------- 讀取頁面 ----------
  function page() {
    /* global Cadastral_source, map_Cadastral_source, send_point, reCalData,
       CadastralStyleSelectFunction, CadastralStyleUNSelectFunction */
    var p = { ok: false, points: [], parcels: [] };
    if (typeof Cadastral_source === 'undefined' || typeof map_Cadastral_source === 'undefined') return p;
    Cadastral_source.getFeatures().forEach(function (f) {
      var g = f.getGeometry();
      if (!g || g.getType() !== 'Point') return;
      if (f.get('TYPE') != null && f.get('TYPE') !== 'Point') return;
      p.points.push({ no: String(f.get('ATTR')), key: norm(f.get('ATTR')), xy: g.getCoordinates(), f: f });
    });
    map_Cadastral_source.getFeatures().forEach(function (f) {
      var g = f.getGeometry();
      if (!g || !/Polygon/.test(g.getType())) return;
      p.parcels.push({ no: String(f.get('ATTR')), mine: String(f.get('COLOR')) === 'true', rings: rings(g.getCoordinates(), []) });
    });
    p.ok = p.points.length > 0;
    return p;
  }

  function currentChecked() {
    var set = {};
    if (typeof send_point !== 'undefined' && send_point && send_point.forEach) {
      send_point.forEach(function (a) { set[norm(a)] = 1; });
    }
    return set;
  }

  function applyChecked(pg, keys) {
    var want = {}, list = [];
    keys.forEach(function (k) { want[k] = 1; });
    pg.points.forEach(function (pt) {
      var on = !!want[pt.key];
      if (on) list.push(pt.f.get('ATTR'));
      try {
        if (on && typeof CadastralStyleSelectFunction === 'function') pt.f.setStyle(CadastralStyleSelectFunction(pt.f));
        if (!on && typeof CadastralStyleUNSelectFunction === 'function') pt.f.setStyle(CadastralStyleUNSelectFunction(pt.f));
      } catch (e) { /* 樣式失敗不影響勾選清單 */ }
    });
    if (typeof send_point === 'undefined') window.send_point = list;
    else send_point = list; // eslint-disable-line no-global-assign
    if (list.length && typeof reCalData === 'function') {
      try { reCalData(true); } catch (e) { /* 使用者可自行按「重新計算」 */ }
    }
    return list.length;
  }

  // ---------- 面板 ----------
  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    var box = el('div', 'position:fixed;top:12px;right:12px;z-index:99999;width:340px;max-height:92vh;overflow:auto;' +
      'background:#fff;border:2px solid #c85a1e;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.35);' +
      'font:15px/1.5 "Microsoft JhengHei",sans-serif;color:#222;padding:10px 12px;');
    box.id = PANEL_ID;

    var head = el('div', 'display:flex;align-items:center;margin-bottom:6px;');
    head.appendChild(el('b', 'flex:1;font-size:17px;color:#c85a1e;', '鑑界點位小幫手'));
    var x = el('button', 'border:0;background:none;font-size:20px;cursor:pointer;line-height:1;', '×');
    x.type = 'button'; x.title = '關閉'; x.onclick = function () { box.remove(); };
    head.appendChild(x);
    box.appendChild(head);

    var info = el('div', 'font-size:13px;color:#555;margin-bottom:6px;');
    box.appendChild(info);

    var btnCss = 'margin:6px 6px 0 0;padding:5px 10px;border:1px solid #c85a1e;border-radius:5px;cursor:pointer;font-size:15px;';
    var inCss = 'width:100%;box-sizing:border-box;padding:5px;border:1px solid #999;border-radius:4px;font-size:15px;';

    box.appendChild(el('div', 'font-weight:bold;margin-top:4px;', '① 要鑑界的點號'));
    var ta = el('textarea', inCss + 'height:64px;resize:vertical;');
    ta.id = 'emh-points'; ta.placeholder = '例：1,2,5-8　（逗號、空白、換行都可以）';
    box.appendChild(ta);

    box.appendChild(el('div', 'font-weight:bold;margin-top:8px;', '② 申請地號（可多筆）'));
    var land = el('input', inCss);
    land.id = 'emh-lands'; land.type = 'text'; land.placeholder = '例：123,123-1';
    box.appendChild(land);

    var b1 = el('button', btnCss + 'background:#c85a1e;color:#fff;', '勾選並列出鄰地');
    b1.id = 'emh-apply'; b1.type = 'button';
    var b2 = el('button', btnCss + 'background:#fff;color:#c85a1e;', '只列鄰地（照目前勾選）');
    b2.id = 'emh-list'; b2.type = 'button';
    box.appendChild(b1); box.appendChild(b2);

    var out = el('pre', 'margin:8px 0 0;padding:8px;background:#f6f3ee;border-radius:5px;white-space:pre-wrap;' +
      'word-break:break-all;font:14px/1.6 "Microsoft JhengHei",sans-serif;min-height:40px;');
    out.id = 'emh-out';
    box.appendChild(out);

    var foot = el('div', 'margin-top:4px;');
    var bc = el('button', btnCss + 'background:#fff;color:#333;border-color:#999;font-size:13px;', '複製結果');
    bc.id = 'emh-copy'; bc.type = 'button';
    var bd = el('button', btnCss + 'background:#fff;color:#888;border-color:#ccc;font-size:12px;', '複製檢查資訊');
    bd.id = 'emh-diag'; bd.type = 'button'; bd.title = '工具不正常時，把這份資訊貼給維護的人';
    foot.appendChild(bc); foot.appendChild(bd);
    box.appendChild(foot);
    document.body.appendChild(box);

    function refreshInfo() {
      var pg = page();
      if (!pg.ok) {
        info.textContent = '還沒有圖資：請先選好地段、輸入地號，按「鑑界複丈規費試算」，圖出來後再按一次按鈕。';
        info.style.color = '#b00';
        return pg;
      }
      info.style.color = '#555';
      var n = Object.keys(currentChecked()).length;
      info.textContent = '本頁共 ' + pg.points.length + ' 個界址點，目前勾選 ' + n + ' 個。';
      if (!land.value) {
        var mine = pg.parcels.filter(function (p) { return p.mine; }).map(function (p) { return p.no; });
        land.value = mine.filter(function (v, i) { return mine.indexOf(v) === i; }).join(',');
      }
      return pg;
    }

    function listNeighbors(pg, prefix) {
      var lines = prefix ? prefix.slice() : [];
      var apps = {}, typed = tokens(land.value);
      typed.forEach(function (t) { apps[normLand(t)] = 1; });
      if (!typed.length) { out.textContent = lines.concat(['請先填「申請地號」。']).join('\n'); return; }
      var have = {};
      pg.parcels.forEach(function (p) { have[normLand(p.no)] = 1; });
      var notOnMap = typed.filter(function (t) { return !have[normLand(t)]; });

      var checked = currentChecked();
      var pts = pg.points.filter(function (p) { return checked[p.key]; });
      if (!pts.length) { out.textContent = lines.concat(['目前沒有勾選任何點。']).join('\n'); return; }

      var r = findNeighbors(pts, pg.parcels, apps);
      lines.push('申請地號：' + typed.join('、'));
      lines.push('勾選點號（' + pts.length + ' 點）：' + pts.map(function (p) { return p.no; }).join('、'));
      lines.push('');
      lines.push('鄰地共 ' + r.lands.length + ' 筆：' + (r.lands.length ? r.lands.join('、') : '（無）'));
      if (r.lands.length) {
        lines.push('');
        lines.push('明細（鄰地：碰到的點）');
        r.lands.forEach(function (l) { lines.push('  ' + l + '：' + r.byLand[l].join('、')); });
      }
      var warn = [];
      if (notOnMap.length) warn.push('圖上找不到這些申請地號：' + notOnMap.join('、') + '（請確認有沒有打錯）');
      if (r.lonely.length) warn.push('這些點沒有碰到任何申請地號，未列入：' + r.lonely.join('、'));
      r.loose.forEach(function (w) { warn.push('點 ' + w.point + ' 與地號 ' + w.land + ' 相距約 ' + w.cm + ' 公分，請目視確認'); });
      if (warn.length) { lines.push(''); lines.push('※ 請注意'); warn.forEach(function (w) { lines.push('  ' + w); }); }
      out.textContent = lines.join('\n');
    }

    b1.onclick = function () {
      var pg = refreshInfo();
      if (!pg.ok) { out.textContent = info.textContent; return; }
      var known = {};
      pg.points.forEach(function (p) { known[p.key] = 1; });
      var r = parsePoints(ta.value, known);
      if (!r.list.length) {
        out.textContent = '沒有可勾選的點號。' + (r.missing.length ? '\n圖上找不到：' + r.missing.join('、') : '請先輸入點號。');
        return;
      }
      var n = applyChecked(pg, r.list);
      refreshInfo();
      var pre = ['已勾選 ' + n + ' 個點，並已重新計算。'];
      if (r.missing.length) pre.push('※ 圖上找不到這些點號，未勾選：' + r.missing.join('、'));
      pre.push('');
      listNeighbors(pg, pre);
    };

    b2.onclick = function () {
      var pg = refreshInfo();
      if (!pg.ok) { out.textContent = info.textContent; return; }
      listNeighbors(pg, []);
    };

    function copy(text, btn) {
      var done = function () { var t = btn.textContent; btn.textContent = '已複製'; setTimeout(function () { btn.textContent = t; }, 1200); };
      var fallback = function () {
        var t = el('textarea', 'position:fixed;left:-9999px;'); t.value = text;
        document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* 無法複製時請手動選取 */ }
        t.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    }
    bc.onclick = function () { copy(out.textContent, bc); };
    bd.onclick = function () { copy(diagnose(), bd); };

    refreshInfo();
    ta.focus();
  }

  function diagnose() {
    var d = { tool: VERSION, url: location.href };
    function sample(name, src) {
      try {
        var fs = src.getFeatures();
        d[name] = {
          count: fs.length,
          sample: fs.slice(0, 5).map(function (f) {
            var o = {}, p = f.getProperties();
            Object.keys(p).forEach(function (k) { if (k !== 'geometry') o[k] = p[k]; });
            var g = f.getGeometry();
            o._geom = g ? g.getType() : null;
            return o;
          })
        };
      } catch (e) { d[name] = 'error: ' + e; }
    }
    d.has = {
      Cadastral_source: typeof Cadastral_source !== 'undefined',
      map_Cadastral_source: typeof map_Cadastral_source !== 'undefined',
      send_point: typeof send_point !== 'undefined',
      reCalData: typeof reCalData === 'function',
      select: typeof CadastralStyleSelectFunction === 'function',
      unselect: typeof CadastralStyleUNSelectFunction === 'function'
    };
    if (d.has.Cadastral_source) sample('points', Cadastral_source);
    if (d.has.map_Cadastral_source) sample('parcels', map_Cadastral_source);
    if (d.has.send_point) { try { d.send_point = send_point.slice(0, 20); } catch (e) { d.send_point = String(e); } }
    return JSON.stringify(d, null, 1);
  }

  // 給測試用
  var api = { norm: norm, normLand: normLand, parsePoints: parsePoints, findNeighbors: findNeighbors, distToRing: distToRing };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  window.__easymapHelper = api;
  buildPanel();
})();
