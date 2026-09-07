// Self-contained dashboard page (no CDN, no build step). Served at GET /dashboard.
export const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eWeLink CUBE Dashboard</title>
<link rel="icon" href="data:,">
<style>
:root { color-scheme: dark; --bg:#0f1419; --card:#1a222c; --line:#2a3542; --txt:#e8eef4; --mut:#8fa0b3; --acc:#4da3ff; --on:#3ddc84; --off:#5a6b7d; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--txt); font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
header h1 { font-size:18px; margin:0; }
.pill { font-size:12px; padding:3px 10px; border-radius:999px; background:var(--card); border:1px solid var(--line); color:var(--mut); }
.pill.ok { color:var(--on); border-color:var(--on); }
main { padding:16px 20px 40px; max-width:1100px; margin:0 auto; display:grid; gap:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.card h2 { margin:0 0 10px; font-size:15px; }
.grid { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
.dev { border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
.dev .nm { font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dev .st { font-size:12px; color:var(--mut); margin-top:4px; line-height:1.7; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
.dot.on { background:var(--on); } .dot.off { background:var(--off); }
button { cursor:pointer; border:1px solid var(--line); background:#243040; color:var(--txt); border-radius:8px; padding:7px 14px; font-size:13px; }
button:hover { border-color:var(--acc); }
button:disabled { opacity:.45; cursor:default; }
.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
select, input[type="date"] { background:#243040; color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:6px 10px; font-size:13px; }
label.chk { font-size:12px; color:var(--mut); display:inline-flex; gap:5px; align-items:center; border:1px solid var(--line); border-radius:999px; padding:3px 10px; margin:2px; cursor:pointer; }
svg.chart { width:100%; height:260px; background:#10161d; border:1px solid var(--line); border-radius:8px; }
.legend { font-size:12px; color:var(--mut); display:flex; gap:14px; flex-wrap:wrap; margin-top:6px; }
.ev { font-size:12px; color:var(--mut); font-family:ui-monospace,monospace; line-height:1.8; max-height:180px; overflow:auto; }
.err { color:#ff7b72; font-size:13px; }
.note { font-size:12.5px; color:var(--mut); line-height:1.9; }
.note b { color:var(--txt); font-weight:600; }
.note table { border-collapse:collapse; margin-top:6px; }
.note td { padding:2px 10px 2px 0; vertical-align:top; }
</style>
</head>
<body>
<header>
<h1>eWeLink CUBE Dashboard</h1>
<span class="pill" id="gw">…</span>
<span class="pill" id="sse">sse …</span>
<span class="pill" id="upd">…</span>
</header>
<main>
<div class="card"><h2>Climate</h2>
<div class="row">
<select id="metric"><option value="temperature">Temperature °C</option><option value="humidity">Humidity %</option><option value="battery">Battery %</option><option value="rssi">Signal dBm</option><option value="electric-power">Power W</option><option value="voltage">Voltage V</option></select>
<select id="range" onchange="rangeChanged()"><option value="24h">24h</option><option value="7d">7d</option><option value="30d">30d</option><option value="all">All</option><option value="custom">Custom dates…</option></select>
<input type="date" id="from" title="From date" disabled oninput="datesChanged()"> <span style="color:var(--mut)">–</span> <input type="date" id="to" title="To date" disabled oninput="datesChanged()">
<button onclick="loadChart()">Update chart</button>
</div>
<div class="row" id="devpick"></div>
<svg class="chart" id="chart" viewBox="0 0 800 260" preserveAspectRatio="none"></svg>
<div class="legend" id="legend"></div>
</div>
<div class="card"><h2>Reading the graphs</h2><div class="note">
Each <b>colored line is one device</b> (see legend under the chart). The <b>X axis is time</b>
in your browser timezone; the <b>Y axis is the metric value</b> in its unit. Points are
<b>5-minute snapshots</b> — flat gaps mean the server was not recording then.
<table>
<tr><td><b>Temperature °C</b></td><td>Air temperature from the device sensor.</td></tr>
<tr><td><b>Humidity %</b></td><td>Relative humidity 0–100%.</td></tr>
<tr><td><b>Battery %</b></td><td>Remaining battery, wireless devices.</td></tr>
<tr><td><b>Signal dBm</b></td><td>Radio strength, negative numbers — nearer 0 is stronger (−50 good, −80 weak).</td></tr>
<tr><td><b>Power W</b></td><td>Current electrical draw in watts.</td></tr>
<tr><td><b>Voltage V</b></td><td>Supply voltage in volts.</td></tr>
</table>
"no data" means the selected devices have no readings for that metric and period.
</div></div>
<div class="card"><h2>Live events</h2><div class="ev" id="events">…</div></div>
</main>
<script>
var COLORS = ["#4da3ff","#3ddc84","#ffb020","#ff7b72","#c792ea","#4dd0e1","#f06292","#aed581"];
var devices = [];
function fmtT(ms){ var d = new Date(ms); function p(n){ return (n<10?"0":"")+n; } return p(d.getDate())+"."+p(d.getMonth()+1)+" "+p(d.getHours())+":"+p(d.getMinutes()); }
async function api(path, opts){ var r = await fetch(path, opts); if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }
async function refresh(){
  try {
    var g = await api("/api/gateway");
    document.getElementById("gw").textContent = g.info.data.name + " · fw " + g.info.data.fw_version;
    var s = g.sse;
    var el = document.getElementById("sse");
    el.textContent = s.connected ? "live · " + s.cachedDevices + " devices" : "sse offline";
    el.className = "pill" + (s.connected ? " ok" : "");
    var d = await api("/api/devices");
    devices = d.data.device_list;
    renderDevices();
    document.getElementById("upd").textContent = "updated " + new Date().toLocaleTimeString();
  } catch(e){ document.getElementById("upd").textContent = "error: " + e.message; }
  try {
    var ev = await api("/api/events?limit=20");
    document.getElementById("events").innerHTML = ev.events.slice().reverse().map(function(x){
      return fmtT(x.receivedAt) + " <b>" + x.type + "</b> " + JSON.stringify(x.data).slice(0,160);
    }).join("<br>");
  } catch(e){}
}
async function renderDevices(){
  // Picker lists every device that has recorded history (any capability).
  try {
    var hist = await api("/api/history/devices");
    var pk = document.getElementById("devpick");
    pk.innerHTML = hist.map(function(d, i){
      return '<label class="chk"><input type="checkbox" data-sn="' + d.serial_number + '"' + (i < 4 ? " checked" : "") + "> " + d.device_name + " <span style='opacity:.6'>(" + d.capabilities.join(",") + ")</span></label>";
    }).join("");
  } catch(e){}
}
function draw(series, unit){
  var svg = document.getElementById("chart");
  var W = 800, H = 260, P = 34;
  var all = []; series.forEach(function(s){ s.pts.forEach(function(p){ all.push(p[1]); }); });
  if (!all.length) { svg.innerHTML = '<text x="20" y="30" fill="#8fa0b3">no data</text>'; return; }
  var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
  if (mx === mn) { mx = mn + 1; }
  var t0 = Infinity, t1 = 0;
  series.forEach(function(s){ s.pts.forEach(function(p){ if (p[0] < t0) t0 = p[0]; if (p[0] > t1) t1 = p[0]; }); });
  function X(t){ return P + (t - t0) / Math.max(1, (t1 - t0)) * (W - 2 * P - 120); }
  function Y(v){ return H - P - (v - mn) / (mx - mn) * (H - 2 * P); }
  function esc(s){ return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var h = "";
  for (var i = 0; i <= 4; i++) {
    var v = mn + (mx - mn) * i / 4, y = Y(v);
    h += '<line x1="' + P + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="#2a3542"/>';
    h += '<text x="2" y="' + (y + 4) + '" fill="#8fa0b3" font-size="10">' + v.toFixed(1) + "</text>";
  }
  series.forEach(function(s, i){
    var col = COLORS[i % COLORS.length];
    var pts = s.pts.map(function(p){ return X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join(" ");
    h += '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.8"><title>' + esc(s.label) + "</title></polyline>";
  });
  h += '<text x="' + P + '" y="' + (H - 8) + '" fill="#8fa0b3" font-size="10">' + fmtT(t0) + "</text>";
  h += '<text x="' + (W - 130) + '" y="' + (H - 8) + '" fill="#8fa0b3" font-size="10">' + fmtT(t1) + "</text>";
  svg.innerHTML = h;
  document.getElementById("legend").innerHTML = series.map(function(s, i){
    return '<span><span class="dot" style="background:' + COLORS[i % COLORS.length] + '"></span>' + s.label + " (" + unit + ")</span>";
  }).join("");
}
function rangeChanged(){
  var custom = document.getElementById("range").value === "custom";
  document.getElementById("from").disabled = !custom;
  document.getElementById("to").disabled = !custom;
  if (!custom) { document.getElementById("from").value = ""; document.getElementById("to").value = ""; }
}
function datesChanged(){
  if (document.getElementById("from").value && document.getElementById("to").value) {
    document.getElementById("range").value = "custom";
    document.getElementById("from").disabled = false;
    document.getElementById("to").disabled = false;
  }
}
async function loadChart(){
  var cap = document.getElementById("metric").value;
  var range = document.getElementById("range").value;
  var from = document.getElementById("from").value;
  var to = document.getElementById("to").value;
  var extra = "";
  if (from && to) {
    extra = "&from=" + encodeURIComponent(from + "T00:00:00") + "&to=" + encodeURIComponent(to + "T23:59:59");
  }
  var unit = cap === "temperature" ? "°C" : (cap === "rssi" ? "dBm" : (cap === "electric-power" ? "W" : (cap === "voltage" ? "V" : "%")));
  var boxes = document.querySelectorAll("#devpick input:checked");
  var series = [];
  for (var i = 0; i < boxes.length; i++) {
    var sn = boxes[i].dataset.sn;
    var txt = boxes[i].parentNode.textContent.trim();
    var cut = txt.indexOf(" (");
    var nm = cut >= 0 ? txt.slice(0, cut) : txt;
    try {
      var j = await api("/api/history?serial=" + encodeURIComponent(sn) + "&capability=" + cap + "&range=" + range + "&limit=5000" + extra);
      var pts = j.readings.map(function(r){ return [r.recorded_at, r.value]; });
      if (pts.length) series.push({ label: nm, pts: pts });
    } catch(e){}
  }
  draw(series, unit);
}
refresh();
setInterval(refresh, 10000);
setTimeout(loadChart, 1500);
</script>
</body>
</html>`;
