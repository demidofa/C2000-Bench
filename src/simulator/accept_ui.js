/* Вкладка «Приемка»: варианты, прогон испытаний, протокол */
(function () {
  'use strict';
  var UI = window.C2KUI, LAB = window.C2KLAB;
  if (!UI || !LAB) return;
  var STUDENT = window.C2K_STUDENT || {};
  var VERSION = window.C2K_VERSION || '1.1';
  var panel = document.getElementById('tp-acc');
  var KEY = 'c2k-acc-v1';
  var st = { who: '', group: '', lab: 'lr1', n: 1 };
  try { var sv = JSON.parse(localStorage.getItem(KEY) || 'null'); if (sv) Object.keys(st).forEach(function (k) { if (sv[k] !== undefined) st[k] = sv[k]; }); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  var esc = UI.esc;
  var busy = false, lastAcc = null;

  function lab() { return LAB.LABS[st.lab] || LAB.list[0]; }
  function variant() { var l = lab(); var n = Math.max(1, Math.min(l.variants, Math.round(+st.n || 1))); return l.variant(n); }

  function render() {
    var l = lab(), v = variant();
    var opts = LAB.list.map(function (x) { return '<option value="' + x.id + '"' + (x.id === st.lab ? ' selected' : '') + '>ЛР' + x.no + '. ' + esc(x.title) + '</option>'; }).join('');
    var h = '<div class="acc-form">' +
      '<div class="fld"><label for="accWho">Исполнитель</label><input id="accWho" type="text" value="' + esc(st.who) + '" placeholder="Фамилия И. О."></div>' +
      '<div class="fld"><label for="accGroup">Группа</label><input id="accGroup" type="text" value="' + esc(st.group) + '"></div>' +
      '<div class="fld"><label for="accLab">Работа</label><select id="accLab">' + opts + '</select></div>' +
      '<div class="fld"><label for="accVar">Вариант</label><input id="accVar" type="number" min="1" max="' + l.variants + '" value="' + v.n + '"></div>' +
      '</div>' +
      '<div class="acc-actions">' +
      '<button class="btn btn-run" id="accRun" type="button">Провести испытания</button>' +
      (STUDENT[l.id] ? '<button class="btn" id="accTpl" type="button">Открыть заготовку ЛР' + l.no + '</button>' : '') +
      '<button class="btn" id="accSave" type="button"' + (lastAcc ? '' : ' disabled') + '>Сохранить протокол</button>' +
      '</div>' +
      '<div class="acc-h">Исходные данные варианта ' + v.n + '</div>' +
      '<div class="tbl-wrap"><table class="acc-table">' + l.describe(v).map(function (d) { return '<tr><td>' + d[0] + '</td><td>' + d[1] + '</td></tr>'; }).join('') + '</table></div>' +
      '<div id="accRes">' + (lastAcc && lastAcc.lab === l && lastAcc.v.n === v.n ? resultsHtml(lastAcc) : planHtml(l, v)) + '</div>';
    panel.innerHTML = h;
    bind();
  }
  function planHtml(l, v) {
    return '<div class="acc-h">Программа испытаний</div><div class="tbl-wrap"><table class="acc-table"><tr><th>№</th><th>Проверка</th><th>Требование</th></tr>' +
      l.tests.map(function (t, i) { return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(t.name) + '<div class="note" style="margin:2px 0 0">' + t.method + '</div></td><td>' + t.req(v) + '</td></tr>'; }).join('') +
      '</table></div>';
  }
  function resultsHtml(a) {
    var l = a.lab, v = a.v, ok = 0;
    var rows = l.tests.map(function (t, i) {
      var r = a.results[t.id]; if (r.ok) ok++;
      return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(t.name) + '</td><td>' + t.req(v) + '</td><td class="meas">' + esc(r.meas) + '</td><td><span class="pill ' + (r.ok ? 'ok' : 'crit') + '">' + (r.ok ? 'соответствует' : 'не соответствует') + '</span></td></tr>';
    }).join('');
    var all = ok === l.tests.length;
    var runs = l.runs(v).map(function (rn) { return '<button class="seg" type="button" data-show="' + rn.id + '">' + rn.id + ': ' + esc(rn.title) + '</button>'; }).join('');
    return '<div class="acc-sum"><span class="pill ' + (all ? 'ok' : 'crit') + '">' + (all ? 'Программа соответствует требованиям' : 'Программа не соответствует требованиям') + '</span><span>Пройдено <b>' + ok + ' из ' + l.tests.length + '</b> проверок, ' + esc(a.date) + '</span></div>' +
      '<div class="tbl-wrap"><table class="acc-table"><tr><th>№</th><th>Проверка</th><th>Требование</th><th>Результат</th><th>Заключение</th></tr>' + rows + '</table></div>' +
      '<div class="acc-runs">Показать на осциллографе режим: ' + runs + '</div>' +
      '<p class="note">Протокол содержит исходные данные варианта, результаты, контрольную сумму SHA-256 и текст испытанной программы. Любое изменение текста меняет контрольную сумму.</p>';
  }
  function bind() {
    var who = document.getElementById('accWho'), gr = document.getElementById('accGroup'), lb = document.getElementById('accLab'), vr = document.getElementById('accVar');
    who.oninput = function () { st.who = who.value; save(); };
    gr.oninput = function () { st.group = gr.value; save(); };
    lb.onchange = function () { st.lab = lb.value; save(); render(); };
    vr.onchange = function () { st.n = Math.max(1, Math.min(lab().variants, Math.round(+vr.value || 1))); save(); render(); };
    document.getElementById('accRun').onclick = runAll;
    var tp = document.getElementById('accTpl');
    if (tp) tp.onclick = function () { var l = lab(); UI.replaceCode(STUDENT[l.id], 'заготовка ЛР' + l.no, l.id + '_student.c'); };
    document.getElementById('accSave').onclick = saveProtocol;
    panel.querySelectorAll('[data-show]').forEach(function (b) {
      b.onclick = function () { if (lastAcc && lastAcc.raw[b.dataset.show] && !lastAcc.raw[b.dataset.show].compileError) UI.showResult(lastAcc.raw[b.dataset.show], 'Испытание, режим ' + b.dataset.show); };
    });
  }

  function runAsync(code, params) {
    return new Promise(function (resolve) {
      var o = C2K.compileAndCreate(code, params, UI.compiler);
      if (o.errors.length) { resolve({ compileError: o.errors.map(function (e) { return (e.line ? 'стр. ' + e.line + ': ' : '') + e.text; }).join('; ') }); return; }
      var r = o.run, ok = r.start(o.compiled, o.lineOffset);
      (function step() {
        var s = ok ? r.advance(1500000) : { done: true };
        if (!s.done) { setTimeout(step, 0); return; }
        resolve(r.finish());
      })();
    });
  }
  async function sha256(text) {
    try {
      var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    } catch (e) { return 'недоступна'; }
  }
  function now() {
    var d = new Date(), p = function (x) { return ('0' + x).slice(-2); };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  async function runAll() {
    if (busy || UI.isRunning()) return;
    busy = true;
    var l = lab(), v = variant(), code = UI.getCode(), runs = l.runs(v), raw = {};
    var btn = document.getElementById('accRun'); btn.disabled = true;
    for (var i = 0; i < runs.length; i++) {
      btn.textContent = 'Испытание ' + (i + 1) + ' из ' + runs.length + '…';
      raw[runs[i].id] = await runAsync(code, runs[i].params);
    }
    var results = l.evaluate(v, raw);
    lastAcc = { lab: l, v: v, raw: raw, results: results, code: code, date: now(), hash: await sha256(code) };
    busy = false;
    render();
    if (raw.A && !raw.A.compileError) UI.showResult(raw.A, 'Испытание, режим A');
  }
  async function saveProtocol() {
    if (!lastAcc) return;
    var a = lastAcc;
    var html = LAB.protocolHtml({ lab: a.lab, variant: a.v, who: st.who, group: st.group, date: a.date, hash: a.hash, code: a.code, results: a.results, version: VERSION });
    var name = 'Протокол_ЛР' + a.lab.no + '_вар' + ('0' + a.v.n).slice(-2) + (st.who ? '_' + st.who.split(/\s+/)[0] : '') + '.html';
    if (window.C2KLocal && window.C2KLocal.saveText) { window.C2KLocal.saveText(name, html, 'Протокол испытаний', '.html', 'text/html'); return; }
    var b = document.getElementById('accSave');
    b.textContent = 'Сохранение протокола доступно в программе для Windows';
    setTimeout(function () { b.textContent = 'Сохранить протокол'; }, 3000);
  }
  // обычный запуск: данные выбранного варианта
  // работа определяется по интерфейсным переменным программы: старшая работа, все переменные которой объявлены
  function labOfCode(code) {
    var best = null;
    LAB.list.forEach(function (l) {
      if (!l.interfaceVars || !l.interfaceVars.length) return;
      var all = l.interfaceVars.every(function (n) { return new RegExp('^\\s*(volatile\\s+)?(float|Uint16|Uint32|int16|int32|int|long|double)\\s+' + n + '\\b', 'm').test(code); });
      if (all && (!best || l.no > best.no)) best = l;
    });
    return best;
  }
  UI.paramsHook = function (p) {
    var lc = UI.getCode ? labOfCode(UI.getCode()) : null;
    if (lc && lc.id !== lab().id) {
      st.lab = lc.id; st.n = Math.max(1, Math.min(lc.variants, st.n || 1)); save(); render();
      var gv = function (id) { var e = document.getElementById(id); return e ? +e.value : undefined; };
      p.Vdc = gv('pVdc'); p.R = gv('pR'); p.L = gv('pL'); p.Tsim = gv('pT');
    }
    var l = lab(), v = variant();
    if (l.sense) p.sense = l.sense(v);
    if ((p.traceVar === null || p.traceVar === undefined) && l.trace) p.traceVar = l.trace;   // переменная работы на осциллографе, пока студент не выбрал другую
    if (l.demo) { var d = l.demo(v); p.plant = d.plant; p.motor = d.motor; p.varEvents = d.varEvents; if (d.encoder) p.encoder = d.encoder; if (d.traceExtra) p.traceExtra = d.traceExtra; if (d.loadEvents) p.loadEvents = d.loadEvents; if (d.scFault) p.scFault = d.scFault; if (d.spike) p.spike = d.spike; if (d.faults) p.faults = d.faults; if (d.sense) p.sense = d.sense; }
  };
  function applyVariantToHeader() {
    var v = variant();
    if (v.vdc) { var a = document.getElementById('pVdc'), b = document.getElementById('pR'), c = document.getElementById('pL');
      if (a) a.value = v.vdc; if (b) b.value = v.R; if (c) c.value = v.L; }
    var pt = document.getElementById('pT');
    if (pt && lab().demo) pt.value = Math.ceil(lab().demo(v).Tsim);
    else if (pt && v.tcal) pt.value = Math.ceil((v.tcal + 2 / v.fout + 0.004) * 1000);
  }
  // интерфейс следует выбранной работе: шапка, поля R и L, вкладка «Опыты», кнопка исходного текста
  var partEl = document.querySelector('.brand .part'), resetBtn = document.getElementById('reset');
  function applyLabUI() {
    var l = lab(), v = variant(), intro = l.id === 'lr1';
    if (partEl) partEl.textContent = 'TMS320F2837xD · ЛР' + l.no + '. ' + l.title;
    ['pR', 'pL'].forEach(function (id) { var e = document.getElementById(id); if (e && e.parentNode) e.parentNode.hidden = v.R === undefined; });
    var tb = document.querySelector('[data-tab="exps"]');
    if (tb) {
      tb.hidden = !intro;
      if (!intro && tb.getAttribute('aria-selected') === 'true') { var m = document.querySelector('[data-tab="meas"]'); if (m) m.click(); }
    }
    if (resetBtn) {
      if (intro || !STUDENT[l.id]) { resetBtn.textContent = 'Исходный текст'; resetBtn.title = 'Исходная программа шага 1 (ЛР1)'; }
      else { resetBtn.textContent = 'Заготовка ЛР' + l.no; resetBtn.title = 'Заготовка программы выбранной работы'; }
    }
  }
  UI.resetHook = function () {
    var l = lab();
    if (l.id === 'lr1' || !STUDENT[l.id]) UI.replaceCode(UI.template, 'исходный текст программы шага 1 (ЛР1)', 'app.c');
    else UI.replaceCode(STUDENT[l.id], 'заготовка ЛР' + l.no, l.id + '_student.c');
  };
  var origRender = render;
  render = function () { origRender(); applyVariantToHeader(); applyLabUI(); };
  render();
})();
