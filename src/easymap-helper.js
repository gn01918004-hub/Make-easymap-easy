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
  var VERSION = '1.4';
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
      .replace(/[\u2027\u00B7\u30FB\u2022]/g, ' ')
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

  // ---------- 列印圖說 ----------
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function inRings(p, rs) {
    var c = false;
    rs.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var a = r[i], b = r[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
    });
    return c;
  }
  function distRings(p, rs) { var d = Infinity; rs.forEach(function (r) { var x = distToRing(p, r); if (x < d) d = x; }); return d; }
  function boxHit(a, b, g) { g = g || 0; return a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g; }
  function segHit(a, b, c, d) {
    function o(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  function numCompare(a, b) {
    var x = parseInt(a, 10), y = parseInt(b, 10);
    if (!isNaN(x) && !isNaN(y) && x !== y) return x - y;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* 畫出申請地、鄰地與界址點；點號用引線拉開，互不重疊。
   * 回傳 { svg, labels:[{no,x,y,w,h}] }（labels 供測試檢查不重疊） */
  function drawFigure(pg, checked, apps, neighborSet) {
    var W = 1000, xs = [], ys = [];
    pg.parcels.forEach(function (pc) {
      if (!apps[normLand(pc.no)]) return;
      pc.rings.forEach(function (r) { r.forEach(function (c) { xs.push(c[0]); ys.push(c[1]); }); });
    });
    pg.points.forEach(function (pt) { if (checked[pt.key] || !xs.length) { xs.push(pt.xy[0]); ys.push(pt.xy[1]); } });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var pad = 0.3 * Math.max(maxx - minx, maxy - miny, 1);
    minx -= pad; maxx += pad; miny -= pad; maxy += pad;
    var w = maxx - minx, h = maxy - miny, e;
    if (h / w < 0.6) { e = (0.6 * w - h) / 2; miny -= e; maxy += e; h = maxy - miny; }
    if (h / w > 0.68) { e = (h / 0.68 - w) / 2; minx -= e; maxx += e; w = maxx - minx; }
    var s = W / w, H = Math.round(h * s);
    function T(c) { return [(c[0] - minx) * s, (maxy - c[1]) * s]; }
    function f1(n) { return Math.round(n * 10) / 10; }

    var parcels = pg.parcels.map(function (pc) {
      return { no: pc.no, mine: !!apps[normLand(pc.no)], nb: !!neighborSet[pc.no], rings: pc.rings.map(function (r) { return r.map(T); }) };
    });
    var pts = pg.points.map(function (pt) { return { no: pt.no, on: !!checked[pt.key], p: T(pt.xy) }; })
      .filter(function (q) { return q.p[0] > 0 && q.p[0] < W && q.p[1] > 0 && q.p[1] < H; });

    // 點號位置：以勾選點的中心向外放，避開其他點號、點位與引線
    var cx = 0, cy = 0, on = pts.filter(function (q) { return q.on; });
    (on.length ? on : pts).forEach(function (q) { cx += q.p[0]; cy += q.p[1]; });
    cx /= (on.length || pts.length || 1); cy /= (on.length || pts.length || 1);
    pts.forEach(function (q) { q.ang = Math.atan2(q.p[1] - cy, q.p[0] - cx); });
    pts.sort(function (a, b) { return (b.on - a.on) || (a.ang - b.ang); });
    var R = 8, boxes = [], leaders = [];
    var marks = pts.map(function (q) { return { x: q.p[0] - R, y: q.p[1] - R, w: 2 * R, h: 2 * R, q: q }; });
    pts.forEach(function (q) {
      var fs = q.on ? 26 : 17, bw = q.no.length * fs * 0.62 + 8, bh = fs + 6, best = null;
      [30, 46, 64, 86, 112, 142, 176].forEach(function (r) {
        for (var k = 0; k < 24; k++) {
          var a = k * Math.PI / 12, c = [q.p[0] + (r + bw / 2) * Math.cos(a), q.p[1] + (r + bh / 2) * Math.sin(a)];
          var b = { x: c[0] - bw / 2, y: c[1] - bh / 2, w: bw, h: bh };
          var da = Math.abs(a - (q.ang < 0 ? q.ang + 2 * Math.PI : q.ang)); if (da > Math.PI) da = 2 * Math.PI - da;
          var cost = r + da * 30;
          if (b.x < 4 || b.y < 4 || b.x + b.w > W - 4 || b.y + b.h > H - 4) cost += 5000;
          boxes.forEach(function (o) { if (boxHit(b, o, 6)) cost += 2000; });
          marks.forEach(function (m) { if (m.q !== q && boxHit(b, m, 3)) cost += 1500; });
          leaders.forEach(function (l) { if (segHit(q.p, c, l[0], l[1])) cost += 400; });
          if (!best || cost < best.cost) best = { cost: cost, b: b, c: c };
        }
      });
      q.box = best.b; q.c = best.c; q.fs = fs;
      boxes.push(best.b); leaders.push([q.p, best.c]);
    });

    // 地號位置：地塊內離邊界最遠、又不壓到點號的位置
    var nx = 44, ny = Math.max(8, Math.round(nx * H / W)), obst = boxes.concat(marks, [{ x: 0, y: 0, w: 90, h: 110 }, { x: 0, y: H - 70, w: 260, h: 70 }]);
    parcels.slice().sort(function (a, b) { return (b.mine - a.mine) || (b.nb - a.nb); }).forEach(function (pc) {
      var fs = pc.mine ? 30 : pc.nb ? 26 : 19, bw = pc.no.length * fs * 0.62 + 8, bh = fs + 6, best = null;
      for (var i = 1; i < nx; i++) for (var j = 1; j < ny; j++) {
        var c = [i * W / nx, j * H / ny];
        if (!inRings(c, pc.rings)) continue;
        var b = { x: c[0] - bw / 2, y: c[1] - bh / 2, w: bw, h: bh };
        if (b.x < 4 || b.y < 4 || b.x + b.w > W - 4 || b.y + b.h > H - 4) continue;
        var sc = Math.min(distRings(c, pc.rings), c[0], c[1], W - c[0], H - c[1]);
        if (obst.some(function (o) { return boxHit(b, o); })) sc -= 1000;
        if (!best || sc > best.sc) best = { sc: sc, c: c, b: b };
      }
      if (best) { pc.c = best.c; pc.fs = fs; obst.push(best.b); }
    });

    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block;border:1px solid #333;background:#fff" font-family="Arial,\'Microsoft JhengHei\',sans-serif">');
    parcels.forEach(function (pc) {
      var d = pc.rings.map(function (r) { return 'M' + r.map(function (c) { return f1(c[0]) + ' ' + f1(c[1]); }).join('L') + 'Z'; }).join('');
      o.push('<path d="' + d + '" fill-rule="evenodd" fill="' + (pc.mine ? '#fff3a0' : pc.nb ? '#eef3fb' : 'none') + '" stroke="' + (pc.mine ? '#000' : '#667') + '" stroke-width="' + (pc.mine ? 3 : 1.3) + '"/>');
    });
    parcels.forEach(function (pc) {
      if (!pc.c) return;
      o.push('<text class="emh-ll" x="' + f1(pc.c[0]) + '" y="' + f1(pc.c[1]) + '" text-anchor="middle" dominant-baseline="central" font-size="' + pc.fs + '"' +
        (pc.mine || pc.nb ? ' font-weight="bold"' : '') + ' fill="' + (pc.mine ? '#000' : pc.nb ? '#1a3e8c' : '#777') + '" stroke="#fff" stroke-width="5" paint-order="stroke">' + esc(pc.no) + '</text>');
    });
    pts.forEach(function (q) {
      o.push('<line x1="' + f1(q.p[0]) + '" y1="' + f1(q.p[1]) + '" x2="' + f1(q.c[0]) + '" y2="' + f1(q.c[1]) + '" stroke="' + (q.on ? '#c00' : '#999') + '" stroke-width="' + (q.on ? 1.4 : 1) + '"/>');
    });
    pts.forEach(function (q) {
      o.push(q.on ? '<circle cx="' + f1(q.p[0]) + '" cy="' + f1(q.p[1]) + '" r="' + R + '" fill="#d00" stroke="#000" stroke-width="1.5"/>'
        : '<circle cx="' + f1(q.p[0]) + '" cy="' + f1(q.p[1]) + '" r="5" fill="#fff" stroke="#777" stroke-width="1.5"/>');
    });
    pts.forEach(function (q) {
      var b = q.box;
      o.push('<rect x="' + f1(b.x) + '" y="' + f1(b.y) + '" width="' + f1(b.w) + '" height="' + f1(b.h) + '" rx="4" fill="#fff" stroke="' + (q.on ? '#c00' : '#aaa') + '" stroke-width="' + (q.on ? 1.6 : 1) + '"/>');
      o.push('<text class="emh-pl" x="' + f1(q.c[0]) + '" y="' + f1(q.c[1]) + '" text-anchor="middle" dominant-baseline="central" font-size="' + q.fs + '"' +
        (q.on ? ' font-weight="bold" fill="#000"' : ' fill="#777"') + '>' + esc(q.no) + '</text>');
    });
    // 指北與比例尺
    o.push('<g transform="translate(40,34)"><path d="M0 34V-14M-9 0L0 -18L9 0" fill="none" stroke="#000" stroke-width="2.5"/><text x="0" y="56" text-anchor="middle" font-size="20">北</text></g>');
    var mPerPx = groundScale([minx, (miny + maxy) / 2]) / s, L = 1;
    [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].forEach(function (v) { if (v / mPerPx <= 220) L = v; });
    var lp = L / mPerPx;
    o.push('<g transform="translate(24,' + (H - 26) + ')"><path d="M0 -8V0H' + f1(lp) + 'V-8" fill="none" stroke="#000" stroke-width="2.5"/><text x="' + f1(lp / 2) + '" y="-8" text-anchor="middle" font-size="18">' + L + ' 公尺</text></g>');
    o.push('</svg>');
    return { svg: o.join(''), labels: pts.map(function (q) { return { no: q.no, x: q.box.x, y: q.box.y, w: q.box.w, h: q.box.h }; }) };
  }

  function placeName() {
    try {
      return ['#city', '#town', '#sect'].map(function (id) {
        var e = document.querySelector(id); return e && e.selectedOptions[0] ? e.selectedOptions[0].text.trim() : '';
      }).join('');
    } catch (e) { return ''; }
  }

  function showPrint(last) {
    var old = document.getElementById('emh-print'); if (old) old.remove();
    var st = document.getElementById('emh-print-css');
    if (!st) {
      st = el('style'); st.id = 'emh-print-css';
      st.textContent = '@media print{body>*:not(#emh-print){display:none!important}#emh-print{position:static!important;padding:0!important;min-height:0!important}' +
        '.emh-noprint{display:none!important}}@page{size:A4 portrait;margin:12mm}' +
        '#emh-print table{border-collapse:collapse;width:100%;margin:4px 0 10px}#emh-print th,#emh-print td{border:1px solid #333;padding:3px 10px;text-align:left;vertical-align:top;font-size:19px;line-height:1.45}' +
        '#emh-print th{background:#eee;white-space:nowrap}#emh-print h2{font-size:20px;margin:10px 0 3px}#emh-print tr{break-inside:avoid}';
      document.head.appendChild(st);
    }
    var checked = {}, nbSet = {}, apps = {};
    last.pts.forEach(function (p) { checked[p.key] = 1; });
    last.r.lands.forEach(function (l) { nbSet[l] = 1; });
    last.typed.forEach(function (t) { apps[normLand(t)] = 1; });
    var fig = drawFigure(last.pg, checked, apps, nbSet);
    var d = new Date(), h = [];
    h.push('<div class="emh-noprint" style="position:sticky;top:0;background:#333;color:#fff;padding:8px 12px;margin:-16px -16px 12px">' +
      '<button type="button" id="emh-doprint" style="font-size:17px;padding:4px 18px;margin-right:10px">列印</button>' +
      '<button type="button" id="emh-closeprint" style="font-size:17px;padding:4px 18px">關閉</button>' +
      '<span style="margin-left:14px;font-size:14px">A4 直式；列印視窗的「邊界」選預設即可</span></div>');
    h.push('<div style="max-width:186mm;margin:0 auto">');
    h.push('<div style="display:flex;align-items:baseline;border-bottom:2px solid #000;padding-bottom:2px"><b style="font-size:21px;flex:1">鑑界界址點及鄰地圖說</b>' +
      '<span style="font-size:13px">' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' 製</span></div>');
    h.push('<div style="margin:5px 0;line-height:1.6">' + (placeName() ? '地段：' + esc(placeName()) + '　' : '') +
      '申請地號：<b>' + esc(last.typed.join('、')) + '</b><br>' +
      '鑑界點號（' + last.pts.length + ' 點）：' + esc(last.pts.map(function (p) { return p.no; }).sort(numCompare).join('、')) + '<br>' +
      '鄰地共 <b>' + last.r.lands.length + '</b> 筆：<b>' + esc(last.r.lands.join('、') || '（無）') + '</b></div>');
    if (last.warns.length) {
      h.push('<div style="border:2px solid #c00;color:#c00;padding:3px 10px;margin:4px 0">※ 請注意<br>' + last.warns.map(esc).join('<br>') + '</div>');
    }
    h.push(fig.svg);
    h.push('<div style="font-size:12.5px;margin:3px 0 6px">圖例：<span style="color:#d00">●</span> 鑑界點（粗字）　○ 未選的界址點（灰字）　' +
      '<span style="background:#fff3a0;border:1px solid #000">　</span> 申請地　<span style="background:#eef3fb;border:1px solid #667">　</span> 鄰地　點號以引線拉開，位置以圓點為準。<br>本圖說依內政部土地複丈規費服務網頁之圖資自動產生，僅供核對與通知作業參考，實際位置以現場土地複丈為準。</div>');
    h.push('<h2>鄰地清冊（共 ' + last.r.lands.length + ' 筆）</h2><table><tr><th style="width:3.5em;text-align:center">序號</th><th style="width:9em">鄰地地號</th><th>碰到的鑑界點</th></tr>');
    last.r.lands.forEach(function (l, i) {
      h.push('<tr><td style="text-align:center">' + (i + 1) + '</td><td><b>' + esc(l) + '</b></td><td>' + esc(last.r.byLand[l].slice().sort(numCompare).join('、')) + '</td></tr>');
    });
    if (!last.r.lands.length) h.push('<tr><td colspan="3">（無）</td></tr>');
    h.push('</table>');
    h.push('</div>');

    var box = el('div', 'position:absolute;left:0;top:0;width:100%;min-height:100%;box-sizing:border-box;z-index:100000;background:#fff;color:#000;padding:16px;font:15px/1.5 "Microsoft JhengHei",sans-serif;');
    box.id = 'emh-print';
    box.innerHTML = h.join('');
    document.body.appendChild(box);
    window.scrollTo(0, 0);
    document.getElementById('emh-doprint').onclick = function () { window.print(); };
    document.getElementById('emh-closeprint').onclick = function () { box.remove(); };
    window.__easymapHelperLabels = fig.labels;
  }

  // ---------- 面板 ----------
  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  var PANEL_CSS = [
    '#emh-panel{position:fixed;top:14px;right:14px;z-index:99999;width:360px;max-height:calc(100vh - 28px);display:flex;flex-direction:column;',
    'background:#fffdfa;border-radius:14px;box-shadow:0 10px 32px rgba(60,30,10,.28),0 0 0 1px rgba(200,90,30,.25);',
    'font:15px/1.55 "Microsoft JhengHei","微軟正黑體",sans-serif;color:#2b2622;overflow:hidden}',
    '#emh-panel *{box-sizing:border-box;font-family:inherit}',
    '#emh-panel .emh-head{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;color:#fff;cursor:move;user-select:none;',
    'background:linear-gradient(135deg,#d9682a,#b9481a)}',
    '#emh-panel .emh-title{font-size:17px;font-weight:bold;letter-spacing:1px}',
    '#emh-panel .emh-ver{font-size:12px;background:rgba(255,255,255,.22);border-radius:10px;padding:0 8px;margin-right:auto}',
    '#emh-panel .emh-hbtn{width:28px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.16);color:#fff;font-size:18px;line-height:28px;cursor:pointer;padding:0}',
    '#emh-panel .emh-hbtn:hover{background:rgba(255,255,255,.32)}',
    '#emh-panel .emh-body{padding:12px 14px 14px;overflow:auto}',
    '#emh-panel.emh-min .emh-body{display:none}',
    '#emh-panel .emh-info{font-size:13px;color:#6b625b;background:#f4eee8;border-radius:8px;padding:4px 10px;margin-bottom:10px}',
    '#emh-panel .emh-info.emh-bad{color:#b3261e;background:#fdecea}',
    '#emh-panel label{display:block;font-weight:bold;margin:2px 0 4px}',
    '#emh-panel .emh-hint{font-weight:normal;font-size:12px;color:#8a817a;margin-left:4px}',
    '#emh-panel textarea,#emh-panel input[type=text]{width:100%;padding:7px 10px;border:1.5px solid #d8cfc7;border-radius:9px;background:#fff;',
    'font-size:17px;color:#222;outline:none;transition:border-color .15s,box-shadow .15s}',
    '#emh-panel textarea{height:72px;resize:vertical;letter-spacing:.5px}',
    '#emh-panel textarea:focus,#emh-panel input[type=text]:focus{border-color:#d9682a;box-shadow:0 0 0 3px rgba(217,104,42,.18)}',
    '#emh-panel .emh-live{min-height:20px;font-size:13px;color:#2e7d32;margin:3px 2px 10px}',
    '#emh-panel .emh-live b{color:#b3261e}',
    '#emh-panel button.emh-main{display:block;width:100%;margin-top:12px;padding:9px;border:0;border-radius:10px;cursor:pointer;',
    'background:#d9682a;color:#fff;font-size:17px;font-weight:bold;box-shadow:0 2px 6px rgba(185,72,26,.35)}',
    '#emh-panel button.emh-main:hover{background:#c45a20}',
    '#emh-panel button.emh-link{display:block;margin:6px auto 0;border:0;background:none;color:#b9481a;font-size:14px;cursor:pointer;text-decoration:underline}',
    '#emh-panel .emh-warn{display:none;margin-top:12px;padding:8px 10px 8px 12px;border-left:5px solid #d32f2f;border-radius:8px;',
    'background:#fdecea;color:#b3261e;font-weight:bold;font-size:14px;white-space:pre-wrap}',
    '#emh-panel .emh-out{margin-top:12px;font-size:14px}',
    '#emh-panel .emh-out:empty{display:none}',
    '#emh-panel .emh-note{color:#2e7d32;font-weight:bold;margin-bottom:6px}',
    '#emh-panel .emh-msg{color:#6b625b;background:#f4eee8;border-radius:8px;padding:8px 10px}',
    '#emh-panel .emh-card{background:#fff;border:1px solid #eadfd5;border-radius:10px;padding:10px 12px}',
    '#emh-panel .emh-sum{font-size:13px;color:#6b625b;line-height:1.6}',
    '#emh-panel .emh-big{font-size:16px;font-weight:bold;margin:8px 0 6px}',
    '#emh-panel .emh-big span{color:#d9682a;font-size:20px}',
    '#emh-panel .emh-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '#emh-panel .emh-chip{background:#fff1e6;border:1px solid #f0c7a8;color:#8a3412;border-radius:16px;padding:1px 12px;font-size:17px;font-weight:bold}',
    '#emh-panel table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}',
    '#emh-panel th,#emh-panel td{border-top:1px solid #f0e8e1;padding:3px 4px;text-align:left;vertical-align:top}',
    '#emh-panel th{color:#8a817a;font-weight:normal;font-size:12px;border-top:0}',
    '#emh-panel td:first-child{font-weight:bold;white-space:nowrap;width:6.5em}',
    '#emh-panel .emh-foot{display:flex;gap:8px;margin-top:12px}',
    '#emh-panel .emh-foot button{flex:1;padding:7px 4px;border-radius:9px;cursor:pointer;font-size:15px;font-weight:bold}',
    '#emh-panel #emh-copy{background:#fff;border:1.5px solid #cbbfb4;color:#4a423c}',
    '#emh-panel #emh-copy:hover{background:#f7f2ed}',
    '#emh-panel #emh-print-btn{background:#2f5fa8;border:1.5px solid #2f5fa8;color:#fff}',
    '#emh-panel #emh-print-btn:hover{background:#264f8d}',
    '#emh-panel #emh-diag{display:block;margin:10px auto 0;border:0;background:none;color:#a39a92;font-size:12px;cursor:pointer}'
  ].join('');

  function buildPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    if (!document.getElementById('emh-panel-css')) {
      var st = el('style'); st.id = 'emh-panel-css'; st.textContent = PANEL_CSS;
      document.head.appendChild(st);
    }

    var box = el('div'); box.id = PANEL_ID;
    var head = el('div'); head.className = 'emh-head';
    head.appendChild(el('span', 'font-size:18px', '📍'));
    var tt = el('span', null, '鑑界點位小幫手'); tt.className = 'emh-title'; head.appendChild(tt);
    var ver = el('span', null, 'v' + VERSION); ver.id = 'emh-ver'; ver.className = 'emh-ver'; head.appendChild(ver);
    var mn = el('button', null, '−'); mn.type = 'button'; mn.className = 'emh-hbtn'; mn.id = 'emh-min'; mn.title = '縮小／展開';
    var x = el('button', null, '×'); x.type = 'button'; x.className = 'emh-hbtn'; x.title = '關閉';
    head.appendChild(mn); head.appendChild(x);
    box.appendChild(head);
    mn.onclick = function () { var m = box.classList.toggle('emh-min'); mn.textContent = m ? '+' : '−'; };
    x.onclick = function () { box.remove(); };

    // 拖曳標題列可以移動面板，避免擋到地圖
    head.addEventListener('mousedown', function (ev) {
      if (ev.target.tagName === 'BUTTON') return;
      var r = box.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      function mv(e) {
        box.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx)) + 'px';
        box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy)) + 'px';
        box.style.right = 'auto';
      }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      ev.preventDefault();
    });

    var body = el('div'); body.className = 'emh-body'; box.appendChild(body);
    var info = el('div'); info.className = 'emh-info'; body.appendChild(info);

    var l1 = el('label', null, '① 鑑界點號');
    var h1 = el('span', null, '用逗號、空白、句點分開；5-8 代表 5 到 8'); h1.className = 'emh-hint'; l1.appendChild(h1);
    body.appendChild(l1);
    var ta = el('textarea'); ta.id = 'emh-points'; ta.placeholder = '例：3411 3412.3413,5-8'; ta.spellcheck = false;
    body.appendChild(ta);
    var live = el('div'); live.className = 'emh-live'; live.id = 'emh-live'; body.appendChild(live);

    var l2 = el('label', null, '② 申請地號');
    var h2 = el('span', null, '多筆用逗號或空白分開'); h2.className = 'emh-hint'; l2.appendChild(h2);
    body.appendChild(l2);
    var land = el('input'); land.id = 'emh-lands'; land.type = 'text'; land.placeholder = '例：123,123-1'; land.spellcheck = false;
    body.appendChild(land);

    var b1 = el('button', null, '✔ 勾選並列出鄰地'); b1.id = 'emh-apply'; b1.type = 'button'; b1.className = 'emh-main';
    var b2 = el('button', null, '只列鄰地（照目前圖上的勾選）'); b2.id = 'emh-list'; b2.type = 'button'; b2.className = 'emh-link';
    body.appendChild(b1); body.appendChild(b2);

    var warn = el('div'); warn.id = 'emh-warn'; warn.className = 'emh-warn'; body.appendChild(warn);
    var out = el('div'); out.id = 'emh-out'; out.className = 'emh-out'; body.appendChild(out);

    var foot = el('div'); foot.className = 'emh-foot';
    var bc = el('button', null, '📋 複製結果'); bc.id = 'emh-copy'; bc.type = 'button';
    var bp = el('button', null, '🖨 列印圖說'); bp.id = 'emh-print-btn'; bp.type = 'button'; bp.title = '點號不重疊的圖 ＋ 鄰地清冊';
    foot.appendChild(bc); foot.appendChild(bp); body.appendChild(foot);
    var bd = el('button', null, '工具不正常時：複製檢查資訊'); bd.id = 'emh-diag'; bd.type = 'button';
    body.appendChild(bd);
    document.body.appendChild(box);

    var last = null, plain = '';
    function showWarn(list) {
      warn.textContent = list.length ? '⚠ 請注意\n' + list.join('\n') : '';
      warn.style.display = list.length ? 'block' : 'none';
    }
    function showMsg(text) {
      plain = text; out.setAttribute('data-text', text); out.innerHTML = '';
      var m = el('div', null, text); m.className = 'emh-msg'; out.appendChild(m);
    }
    function htmlEsc(t) { return esc(t); }

    function refreshInfo() {
      var pg = page();
      if (!pg.ok) {
        info.textContent = '還沒有圖資：請先選好地段、輸入地號，按「鑑界複丈規費試算」，圖出來後再按一次按鈕。';
        info.className = 'emh-info emh-bad';
        return pg;
      }
      info.className = 'emh-info';
      var n = Object.keys(currentChecked()).length;
      info.textContent = '本頁共 ' + pg.points.length + ' 個界址點，目前勾選 ' + n + ' 個。';
      if (!land.value) {
        var mine = pg.parcels.filter(function (p) { return p.mine; }).map(function (p) { return p.no; });
        land.value = mine.filter(function (v, i) { return mine.indexOf(v) === i; }).join(',');
      }
      return pg;
    }

    // 邊打字邊檢查點號，打錯的先標紅
    function updateLive() {
      var pg = page();
      if (!pg.ok || !ta.value.trim()) { live.innerHTML = ''; return; }
      var known = {};
      pg.points.forEach(function (p) { known[p.key] = 1; });
      var r = parsePoints(ta.value, known);
      live.innerHTML = '將勾選 ' + r.list.length + ' 點' +
        (r.missing.length ? '　<b>圖上沒有：' + htmlEsc(r.missing.join('、')) + '</b>' : '');
    }
    ta.addEventListener('input', updateLive);

    function listNeighbors(pg, note, missing) {
      last = null;
      var warns = [], pre = note ? note + '\n\n' : '';
      if (missing && missing.length) warns.push('圖上沒有這些點號（可能輸錯），未勾選：' + missing.join('、'));
      var apps = {}, typed = tokens(land.value);
      typed.forEach(function (t) { apps[normLand(t)] = 1; });
      if (!typed.length) { showWarn(warns); showMsg(pre + '請先填「申請地號」。'); return; }
      var have = {};
      pg.parcels.forEach(function (p) { have[normLand(p.no)] = 1; });
      var notOnMap = typed.filter(function (t) { return !have[normLand(t)]; });
      if (notOnMap.length) warns.push('圖上找不到這些申請地號：' + notOnMap.join('、') + '（請確認有沒有打錯）');

      var checked = currentChecked();
      var pts = pg.points.filter(function (p) { return checked[p.key]; });
      if (!pts.length) { showWarn(warns); showMsg(pre + '目前沒有勾選任何點。'); return; }

      var r = findNeighbors(pts, pg.parcels, apps);
      if (r.lonely.length) warns.push('這些點沒有碰到任何申請地號，未列入：' + r.lonely.join('、'));
      r.loose.forEach(function (w) { warns.push('點 ' + w.point + ' 與地號 ' + w.land + ' 相距約 ' + w.cm + ' 公分，請目視確認'); });
      var ptsTxt = pts.map(function (p) { return p.no; }).join('、');

      var lines = [];
      if (note) lines.push(note, '');
      lines.push('申請地號：' + typed.join('、'));
      lines.push('勾選點號（' + pts.length + ' 點）：' + ptsTxt);
      lines.push('');
      lines.push('鄰地共 ' + r.lands.length + ' 筆：' + (r.lands.length ? r.lands.join('、') : '（無）'));
      if (r.lands.length) {
        lines.push('');
        lines.push('明細（鄰地：碰到的點）');
        r.lands.forEach(function (l) { lines.push('  ' + l + '：' + r.byLand[l].join('、')); });
      }
      plain = lines.join('\n');
      out.setAttribute('data-text', plain);

      var h = [];
      if (note) h.push('<div class="emh-note">✔ ' + htmlEsc(note) + '</div>');
      h.push('<div class="emh-card"><div class="emh-sum">申請地號：' + htmlEsc(typed.join('、')) +
        '<br>勾選點號（' + pts.length + ' 點）：' + htmlEsc(ptsTxt) + '</div>');
      h.push('<div class="emh-big">鄰地共 <span>' + r.lands.length + '</span> 筆</div>');
      if (r.lands.length) {
        h.push('<div class="emh-chips">' + r.lands.map(function (l) { return '<span class="emh-chip">' + htmlEsc(l) + '</span>'; }).join('') + '</div>');
        h.push('<table><tr><th>鄰地地號</th><th>碰到的鑑界點</th></tr>' + r.lands.map(function (l) {
          return '<tr><td>' + htmlEsc(l) + '</td><td>' + htmlEsc(r.byLand[l].join('、')) + '</td></tr>';
        }).join('') + '</table>');
      } else {
        h.push('<div class="emh-sum">（勾選的點沒有碰到其他土地）</div>');
      }
      h.push('</div>');
      out.innerHTML = h.join('');
      showWarn(warns);
      last = { pg: pg, typed: typed, pts: pts, r: r, warns: warns };
    }

    b1.onclick = function () {
      var pg = refreshInfo();
      if (!pg.ok) { showWarn([]); showMsg(info.textContent); return; }
      var known = {};
      pg.points.forEach(function (p) { known[p.key] = 1; });
      var r = parsePoints(ta.value, known);
      if (!r.list.length) {
        last = null;
        showWarn(r.missing.length ? ['圖上沒有這些點號（可能輸錯）：' + r.missing.join('、')] : []);
        showMsg(r.missing.length ? '沒有可勾選的點號，圖上的勾選沒有變動。' : '請先輸入點號。');
        return;
      }
      var n = applyChecked(pg, r.list);
      refreshInfo();
      listNeighbors(pg, '已勾選 ' + n + ' 個點，並已重新計算。', r.missing);
    };

    b2.onclick = function () {
      var pg = refreshInfo();
      if (!pg.ok) { showWarn([]); showMsg(info.textContent); return; }
      listNeighbors(pg, '', null);
    };

    function copy(text, btn) {
      var done = function () { var t = btn.textContent; btn.textContent = '✔ 已複製'; setTimeout(function () { btn.textContent = t; }, 1200); };
      var fallback = function () {
        var t = el('textarea', 'position:fixed;left:-9999px;'); t.value = text;
        document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* 無法複製時請手動選取 */ }
        t.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    }
    bc.onclick = function () { copy((warn.textContent ? warn.textContent + '\n\n' : '') + plain, bc); };
    bp.onclick = function () {
      var pg = refreshInfo();
      if (!pg.ok) { showWarn([]); showMsg(info.textContent); return; }
      if (!last) listNeighbors(pg, '', null);
      if (last) showPrint(last);
    };
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
  var api = { drawFigure: drawFigure, norm: norm, normLand: normLand, parsePoints: parsePoints, findNeighbors: findNeighbors, distToRing: distToRing };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  window.__easymapHelper = api;
  buildPanel();
})();
