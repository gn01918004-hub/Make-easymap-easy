// 產生 dist/安裝說明.html（含可拖曳的書籤按鈕）與 dist/easymap-helper.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/easymap-helper.js'), 'utf8');
const version = /var VERSION = '([^']+)'/.exec(src)[1];
const href = 'javascript:' + encodeURIComponent(src) + ';void 0';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const html = `<!DOCTYPE html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8">
<title>鑑界點位小幫手 v${version} 安裝說明</title>
<style>
body{font:17px/1.8 "Microsoft JhengHei",sans-serif;max-width:760px;margin:30px auto;padding:0 16px;color:#222}
h1{color:#c85a1e;font-size:26px} h2{font-size:20px;margin-top:28px;border-left:5px solid #c85a1e;padding-left:10px}
.bm{display:inline-block;padding:8px 18px;background:#c85a1e;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;cursor:grab}
textarea{width:100%;height:90px;font:12px monospace} kbd{border:1px solid #999;border-radius:4px;padding:0 5px;background:#eee}
.note{background:#fff7e6;border:1px solid #e8c88a;border-radius:6px;padding:8px 14px}
button{font-size:16px;padding:4px 12px}
</style></head><body>
<h1>鑑界點位小幫手 v${version}</h1>
<p>搭配「土地複丈規費(鑑界、分割)服務」網頁使用：輸入點號就自動勾選，並列出碰到的鄰地地號。</p>

<h2>安裝（只要做一次）</h2>
<ol>
<li>按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> 讓 Chrome 上方出現「書籤列」。</li>
<li>用滑鼠把下面這顆橘色按鈕<b>拖到書籤列</b>上放開：<br>
<a class="bm" id="bm" href="${esc(href)}">鑑界小幫手</a></li>
</ol>

<h2>使用</h2>
<ol>
<li>開啟 <a href="https://easymap.moi.gov.tw/BSWeb/" target="_blank">https://easymap.moi.gov.tw/BSWeb/</a>，選地段、輸入地號，按「鑑界複丈規費試算」，等地籍圖出來。</li>
<li>按書籤列上的「鑑界小幫手」，右上角會出現小面板。</li>
<li>在 ① 輸入紙本附件上的點號（例：<code>1,2,5-8</code>），② 確認申請地號（會自動帶入查詢的地號，多筆用逗號分開）。</li>
<li>按「勾選並列出鄰地」：圖上的點會勾好、規費重新計算，面板下方列出鄰地。</li>
<li>若是自己在圖上手動勾選，按「只列鄰地（照目前勾選）」即可。</li>
<li>「複製結果」可貼到 Word、Excel 或通知書清冊。</li>
<li>「列印圖說」會產生 A4 一張：點號用引線拉開不重疊的圖，加上鄰地清冊與點位對照表；按上方「列印」印出，「關閉」回到原頁面。</li>
<li>輸入了圖上沒有的點號（可能輸錯）時，面板會出現紅框提醒，那些點號不會被勾選。</li>
</ol>
<p class="note">鄰地的算法：勾選的點如果同時碰到「申請地號」和「不是申請地號」的土地，那筆不是申請地號的土地就算鄰地。<br>
列出的鄰地以該網頁圖上畫出的地號為準，寄發通知前請再目視核對一次。</p>

<h2>書籤拖不進去時（備用方法）</h2>
<ol>
<li>在該網頁按 <kbd>F12</kbd>，點上方「Console（主控台）」。</li>
<li>按下面的「複製程式」，到主控台貼上（第一次要先輸入 <code>allow pasting</code> 再按 Enter），按 Enter。</li>
</ol>
<button type="button" onclick="var t=document.getElementById('code');t.select();document.execCommand('copy');this.textContent='已複製'">複製程式</button>
<textarea id="code" readonly>${esc(src)}</textarea>
</body></html>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/安裝說明.html'), html);
fs.writeFileSync(path.join(root, 'dist/easymap-helper.js'), src);
console.log('built v' + version, 'bookmarklet bytes:', href.length);
