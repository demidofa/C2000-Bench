/* Приемочные испытания лабораторных работ (программа и методика испытаний)
 * Используется стендом (браузер) и сборочными сценариями (node).
 */
var C2KLAB = (function () {
  'use strict';
  var HZ = 1e8;

  function rng(seed) {
    var a = seed | 0;
    return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function stepIn(r, a, b, st) { var n = Math.round((b - a) / st); return +(a + st * Math.floor(r() * (n + 1))).toFixed(6); }
  function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', ','); }

  /* ------------------------------------------------------------ */
  /* ЛР1                                                          */
  /* ------------------------------------------------------------ */
  var FSW = [8000, 10000, 12500, 16000, 20000];
  function lr1Variant(n) {
    var r = rng(7919 * n + 101);
    var v = { n: n };
    v.fsw = FSW[(n - 1) % FSW.length];
    v.tbprd = Math.round(HZ / (2 * v.fsw));
    v.vdc = pick(r, [24, 36, 48]);
    v.R = stepIn(r, 1.0, 4.0, 0.1);
    v.L = stepIn(r, 2.0, 8.0, 0.5);             // мГн
    v.fout = stepIn(r, 25, 60, 5);
    v.m = stepIn(r, 0.60, 0.90, 0.05);
    v.tdon = Math.round(8 + 17 * r());           // нс, минимальная задержка включения ключа
    v.tdoff = Math.round(40 + 80 * r());         // нс, максимальная задержка выключения ключа
    v.tpdmin = 10 * Math.round(4 + 11 * r());    // нс, задержка драйвера, минимум
    v.tpdmax = v.tpdmin + 10 * Math.round(4 + 31 * r());
    v.dtReq = 10 * Math.ceil(1.2 * ((v.tdoff - v.tdon) + (v.tpdmax - v.tpdmin)) / 10 - 1e-9); // нс
    v.dbTicks = v.dtReq / 10;
    v.gpio = [12, 13, 14, 15][(n * 7 + 3) % 4];
    return v;
  }

  // основная гармоника кусочно-постоянного сигнала [тик, значение,...] на интервале
  function fundamental(ed, endTick, t0, t1, f, offset) {
    var w = 2 * Math.PI * f / HZ, re = 0, im = 0;
    for (var k = 0; k < ed.length; k += 2) {
      var a = Math.max(ed[k], t0), b = Math.min(k + 2 < ed.length ? ed[k + 2] : endTick, t1);
      if (b <= a) continue;
      var v = ed[k + 1] - offset;
      // интеграл v*exp(-jwt) dt = v*(exp(-jwa)-exp(-jwb))/(jw)
      var ca = Math.cos(w * a), sa = Math.sin(w * a), cb = Math.cos(w * b), sb = Math.sin(w * b);
      // (ca - j sa - cb + j sb)/(j w) = ( (sb - sa) + j(... ) )...
      var dr = ca - cb, di = -sa + sb;          // числитель: dr + j di
      re += v * (di / w); im += v * (-dr / w);  // деление на j w
    }
    var T = t1 - t0;
    return 2 * Math.hypot(re, im) / T;
  }
  function levelAt(ed, tick) { var v = null; for (var k = 0; k < ed.length && ed[k] <= tick; k += 2) v = ed[k + 1]; return v; }

  var LR1 = {
    id: 'lr1', no: 1,
    title: 'Формирование управляющих импульсов стойки инвертора',
    variants: 30,
    variant: lr1Variant,
    interfaceVars: ['m_index', 'f_out'],
    describe: function (v) {
      return [
        ['Частота ШИМ f<sub>ШИМ</sub>', fmt(v.fsw / 1000, 1) + ' кГц'],
        ['Напряжение звена постоянного тока U<sub>d</sub>', v.vdc + ' В'],
        ['Нагрузка R, L', fmt(v.R, 1) + ' Ом, ' + fmt(v.L, 1) + ' мГн'],
        ['Частота выходного напряжения f<sub>1</sub>', v.fout + ' Гц'],
        ['Глубина модуляции m', fmt(v.m, 2)],
        ['Задержка включения ключа t<sub>d(on) min</sub>', v.tdon + ' нс'],
        ['Задержка выключения ключа t<sub>d(off) max</sub>', v.tdoff + ' нс'],
        ['Задержка драйвера t<sub>pd min</sub> … t<sub>pd max</sub>', v.tpdmin + ' … ' + v.tpdmax + ' нс'],
        ['Вход сигнала аварии драйвера nFAULT', 'GPIO' + v.gpio + ', открытый сток, без внешнего резистора']
      ];
    },
    runs: function (v) {
      var base = { Vdc: v.vdc, R: v.R, L: v.L, seed: 1000 + v.n };
      var tA = 2 / v.fout + 0.005;
      return [
        { id: 'A', title: 'номинальный режим', params: Object.assign({}, base, { Tsim: tA * 1e3, overrides: { m_index: v.m, f_out: v.fout } }) },
        { id: 'B', title: 'задание с перемодуляцией', params: Object.assign({}, base, { Tsim: (1 / v.fout + 0.004) * 1e3, overrides: { m_index: 1.15, f_out: v.fout } }) },
        { id: 'C', title: 'сигнал аварии драйвера', params: Object.assign({}, base, { Tsim: 25, overrides: { m_index: v.m, f_out: v.fout }, faults: [{ pin: v.gpio, t0: 0.015, t1: 0.01502 }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'Частота ШИМ', req: function (v) { return fmt(v.fsw / 1000, 3) + ' кГц ± 0,1 %'; }, method: 'По моментам TBCTR = 0 в номинальном режиме.' },
      { id: 'И2', name: 'Частота вызова обработчика прерывания', req: function (v) { return 'один вызов за период ШИМ, ' + fmt(v.fsw / 1000, 3) + ' кГц ± 0,1 %'; }, method: 'По моментам входа в обработчик в номинальном режиме.' },
      { id: 'И3', name: 'Мертвое время', req: function (v) { return 'от ' + v.dtReq + ' до ' + (v.dtReq + 100) + ' нс в обоих направлениях'; }, method: 'Пауза между спадом одного выхода стойки и фронтом другого, все переключения номинального режима.' },
      { id: 'И4', name: 'Отсутствие сквозного тока', req: function () { return 'ключи стойки не открыты одновременно'; }, method: 'Во всех режимах испытаний.' },
      { id: 'И5', name: 'Основная гармоника напряжения стойки', req: function (v) { return 'm·U<sub>d</sub>/2 = ' + fmt(v.m * v.vdc / 2, 2) + ' В ± 5 % на частоте ' + v.fout + ' Гц'; }, method: 'Амплитуда первой гармоники напряжения средней точки стойки относительно средней точки звена за два последних периода f<sub>1</sub>.' },
      { id: 'И6', name: 'Ограничение коэффициента заполнения', req: function () { return '0 ≤ CMPA ≤ TBPRD, без переполнения полей'; }, method: 'Задание m = 1,15 при номинальной частоте f<sub>1</sub>.' },
      { id: 'И7', name: 'Время аварийного отключения', req: function () { return 'не более 0,2 мкс'; }, method: 'Импульс низкого уровня 20 мкс на входе nFAULT при t = 15 мс; время до закрытия обоих ключей.' },
      { id: 'И8', name: 'Фиксация аварии', req: function () { return 'ключи закрыты до конца испытания после снятия сигнала аварии'; }, method: 'Тот же опыт; контроль выходов после окончания импульса nFAULT.' },
      { id: 'И9', name: 'Отсутствие ложных срабатываний защиты', req: function () { return 'нет аварийных отключений без сигнала nFAULT'; }, method: 'Номинальный режим при помехах на входе аварии.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Запись в защищенные регистры только между EALLOW и EDIS, сброс ETFLG и подтверждение PIE в каждом вызове обработчика, наличие интерфейсных переменных, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, B = R.B, Cr = R.C, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      var Aok = A && !A.compileError;
      if (!Aok) {
        LR1.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + (A ? A.compileError : 'нет результата')); });
        return out;
      }
      var m = A.measures;
      function pwmOk(x, from, to) {
        if (!x || x.compileError) return false;
        var n = 0;
        [x.logs.edA, x.logs.edB].forEach(function (ed) { for (var k = 0; k < ed.length; k += 2) if (ed[k] >= (from || 0) && ed[k] <= (to === undefined ? Infinity : to)) n++; });
        return n >= 8;
      }
      var NOPWM = 'не проведено: ключи стойки не переключаются';
      // И1
      if (!m.fpwm) out['И1'] = bad('счетчик ePWM1 не работает');
      else { var e1 = (m.fpwm - v.fsw) / v.fsw * 100; out['И1'] = res(Math.abs(e1) <= 0.1, fmt(m.fpwm / 1000, 3) + ' кГц (' + (e1 >= 0 ? '+' : '') + fmt(e1, 2) + ' %)'); }
      // И2
      if (!m.fisr || A.isrCount < 3) out['И2'] = bad(A.isrCount + ' вызовов, обработчик не работает периодически');
      else { var e2 = (m.fisr - v.fsw) / v.fsw * 100; out['И2'] = res(Math.abs(e2) <= 0.1, fmt(m.fisr / 1000, 3) + ' кГц, ' + A.isrCount + ' вызовов'); }
      // И3
      if (!m.dtAB || !m.dtBA) out['И3'] = bad('пауза не обнаружена: ' + (m.shootN ? 'выходы перекрываются' : 'выходы не переключаются в противофазе'));
      else {
        var lo = Math.min(m.dtAB.min, m.dtBA.min) * 1e9, hi = Math.max(m.dtAB.max, m.dtBA.max) * 1e9;
        out['И3'] = res(lo >= v.dtReq - 5 && hi <= v.dtReq + 105, 'после спада A ' + Math.round(m.dtAB.min * 1e9) + (Math.abs(m.dtAB.max - m.dtAB.min) > 1e-9 ? '…' + Math.round(m.dtAB.max * 1e9) : '') + ' нс, после спада B ' + Math.round(m.dtBA.min * 1e9) + (Math.abs(m.dtBA.max - m.dtBA.min) > 1e-9 ? '…' + Math.round(m.dtBA.max * 1e9) : '') + ' нс');
      }
      // И4
      var sh = [A, B, Cr].map(function (x) { return x && !x.compileError ? x.measures.shootN : 0; });
      var shT = sh[0] + sh[1] + sh[2];
      out['И4'] = !pwmOk(A) ? bad(NOPWM) : res(shT === 0, shT === 0 ? 'одновременного открытия нет' : 'одновременное открытие: ' + shT + ' раз');
      // И5
      var T = A.endTick, per = HZ / v.fout;
      if (T < 2 * per) out['И5'] = bad('моделирование остановлено раньше окончания интервала измерения');
      else {
        var u1 = fundamental(A.logs.vEd, T, T - 2 * per, T, v.fout, v.vdc / 2), u1r = v.m * v.vdc / 2, e5 = (u1 - u1r) / u1r * 100;
        out['И5'] = res(Math.abs(e5) <= 5, fmt(u1, 2) + ' В (' + (e5 >= 0 ? '+' : '') + fmt(e5, 1) + ' %)');
      }
      // И6
      if (!B || B.compileError) out['И6'] = bad('испытание не проведено');
      else {
        var prd = B.measures.prdA, c = B.cmpa;
        if (!c.writes) out['И6'] = bad('обработчик не записывает CMPA');
        else {
          var ok6 = c.max <= prd && c.min >= 0 && B.ovf === 0;
          out['И6'] = res(ok6, 'CMPA от ' + c.min + ' до ' + c.max + ' при TBPRD = ' + prd + (B.ovf ? ', переполнений поля: ' + B.ovf : ''));
        }
      }
      // И7, И8
      if (!Cr || Cr.compileError) { out['И7'] = bad('испытание не проведено'); out['И8'] = bad('испытание не проведено'); }
      else {
        var fa = Math.round(0.015 * HZ), fb = Math.round(0.01502 * HZ);
        var LA = Cr.logs.edA, LB = Cr.logs.edB;
        if (!pwmOk(Cr, fa - 0.002 * HZ, fa)) { out['И7'] = bad(NOPWM + ' перед опытом'); out['И8'] = bad(NOPWM + ' перед опытом'); }
        else if (Cr.endTick < fb + 1000) { out['И7'] = bad('моделирование остановлено до опыта'); out['И8'] = bad('моделирование остановлено до опыта'); }
        else {
          // момент, когда оба выхода стали низкими и остались такими после fa
          function lastHigh(ed, from, to) { var t = null, lv = levelAt(ed, from); if (lv === 1) t = from; for (var k = 0; k < ed.length; k += 2) { if (ed[k] < from || ed[k] > to) continue; if (ed[k + 1] === 1) t = ed[k]; else if (t !== null && t <= ed[k]) t = ed[k] - 1; } return t; }
          var winEnd = fa + 2000;            // 20 мкс
          var ha = lastHigh(LA, fa, winEnd), hb = lastHigh(LB, fa, winEnd);
          var offA = levelAt(LA, winEnd) === 1 ? null : (ha === null ? fa : ha + 1);
          var offB = levelAt(LB, winEnd) === 1 ? null : (hb === null ? fa : hb + 1);
          if (offA === null || offB === null) out['И7'] = bad('ключи не закрылись за время импульса nFAULT');
          else { var td = (Math.max(offA, offB) - fa) / HZ * 1e6; out['И7'] = res(td <= 0.2, td < 0.011 ? 'менее 0,01 мкс' : fmt(td, 2) + ' мкс'); }
          var rises = 0;
          [LA, LB].forEach(function (ed) { for (var k = 0; k < ed.length; k += 2) if (ed[k] > fa + 20 && ed[k + 1] === 1) rises++; });
          out['И8'] = res(rises === 0 && offA !== null && offB !== null, rises ? 'после аварии ключи включались снова: ' + rises + ' раз' : 'ключи закрыты до конца испытания');
        }
      }
      // И9
      var falseTrip = [];
      if (A.tripTick !== null) falseTrip.push('отключение ' + (A.tripSrc === 'TZFRC' ? 'программной командой TZFRC' : 'по входу TZ1') + ' при t = ' + fmt(A.tripTick / HZ * 1e3, 3) + ' мс');
      if (A.cbcTick !== null) falseTrip.push('циклическое отключение при t = ' + fmt(A.cbcTick / HZ * 1e3, 3) + ' мс');
      out['И9'] = !pwmOk(A) ? bad(NOPWM) : res(falseTrip.length === 0, falseTrip.length ? falseTrip.join('; ') : 'ложных срабатываний нет');
      // И10
      var viol = [];
      [A, B, Cr].forEach(function (x) {
        if (!x || x.compileError) return;
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('etclr') >= 0) viol.push('не сбрасывается ETFLG.INT');
        if (x.warnKeys.indexOf('ack') >= 0) viol.push('нет подтверждения PIEACK');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };

  /* ------------------------------------------------------------ */
  /* ЛР2. Измерение тока                                          */
  /* ------------------------------------------------------------ */
  var RSH = [5, 7.5, 10, 15, 20], GAMP = [5, 10, 20, 40];
  function lr2Variant(n) {
    var v = lr1Variant(n), r = rng(104729 * n + 7);
    var Z = Math.hypot(v.R, 2 * Math.PI * v.fout * v.L * 1e-3);
    v.i1m = v.m * v.vdc / 2 / Z;
    v.ch = 2 + Math.floor(r() * 4);
    v.tSmin = 5 * Math.round((75 + 325 * r()) / 5);
    v.acqps = Math.ceil(v.tSmin / 5 - 1e-9) - 1;
    var tw = (v.acqps + 1) * 5e-9;
    var tsetMax = Math.min(3.5e-6, 0.12 / (2 * v.fsw) - tw);
    v.tset = Math.round((1.2e-6 + (tsetMax - 1.2e-6) * r()) * 1e7) / 1e7;
    v.dmax = 1 - 2 * (v.tset + tw) * v.fsw;
    var ibmax = 1.1 * v.vdc / 2 / Z;          // перемодуляция: D ограничен нулем, напряжение до Ud/2
    v.itrip = Math.ceil(12.5 * Math.max(ibmax, v.i1m)) / 10;
    var best = null, target = v.itrip / 0.7;
    RSH.forEach(function (rs) { GAMP.forEach(function (g) {
      var ifs = 1.65 / (g * rs * 1e-3);
      if (ifs < v.itrip / 0.85) return;
      var c = Math.abs(Math.log(ifs / target));
      if (!best || c < best.c) best = { c: c, rs: rs, g: g, ifs: ifs };
    }); });
    if (!best) best = { rs: 5, g: 5, ifs: 66 };
    v.rsh = best.rs; v.g = best.g; v.ifs = best.ifs;
    v.pol = r() < 0.5 ? 1 : -1;
    v.tcal = 256 / v.fsw;
    return v;
  }
  function sensorFor(v, seed) {
    var r = rng(seed * 31 + 17);
    var voff = (0.015 + 0.025 * r()) * (r() < 0.5 ? -1 : 1);
    var gerr = (r() * 2 - 1) * 0.008;
    return { ch: v.ch, rsh: v.rsh * 1e-3, g: v.g, pol: v.pol, voff: voff, gerr: gerr, tauAmp: v.tset / 6.9, tauS: v.tSmin * 1e-9 / Math.log(8192) };
  }
  function adcTuples(x) {
    var a = x.logs.adcS, out = [];
    for (var k = 0; k + 6 < a.length; k += 7) out.push({ t0: a[k], tS: a[k + 1], i: a[k + 2], ch: a[k + 3], tw: a[k + 4], soc: a[k + 5], code: a[k + 6] });
    return out;
  }
  function enableTick(x) {
    var ev = x.logs.tzEv, en = 0, any = false;
    for (var k = 0; k < ev.length; k += 2) { if (ev[k + 1] === 'CLR') { if (!any) { en = ev[k]; any = true; } } }
    var frc0 = ev.length && ev[1] === 'FRC' && ev[0] <= 10;
    return frc0 ? (any ? en : null) : 0;
  }
  function pairs(x, from) {
    var tp = adcTuples(x), vt = x.logs.varT, out = [], j = -1;
    for (var k = 0; k < vt.length; k += 2) {
      var t = vt[k]; if (t < from) continue;
      while (j + 1 < tp.length && tp[j + 1].tS <= t) j++;
      if (j < 0 || !isFinite(vt[k + 1])) continue;
      out.push({ t: t, meas: vt[k + 1], tru: tp[j].i });
    }
    return out;
  }
  function trips(x, from) { var ev = x.logs.tzEv, o = []; for (var k = 0; k < ev.length; k += 2) if (ev[k] > from && ev[k + 1] !== 'CLR') o.push({ t: ev[k], src: ev[k + 1] }); return o; }

  var LR2 = {
    id: 'lr2', no: 2,
    title: 'Измерение тока стойки инвертора',
    variants: 30,
    variant: lr2Variant,
    interfaceVars: ['m_index', 'f_out', 'i_meas'],
    sense: function (v) { return sensorFor(v, 1); },
    trace: 'i_meas',
    describe: function (v) {
      return LR1.describe(v).concat([
        ['Датчик тока', 'шунт в цепи нижнего ключа ' + fmt(v.rsh, 1) + ' мОм, усилитель G = ' + v.g + ', смещение U<sub>ref</sub>/2 = 1,65 В'],
        ['Полярность датчика', v.pol > 0 ? 'выходное напряжение растет с ростом тока фазы' : 'выходное напряжение убывает с ростом тока фазы'],
        ['Вход АЦП', 'ADCINA' + v.ch + ' (АЦП A, 12 бит, U<sub>ref</sub> = 3,3 В)'],
        ['Минимальное окно выборки t<sub>S min</sub>', v.tSmin + ' нс'],
        ['Время установления усилителя t<sub>уст</sub>', fmt(v.tset * 1e6, 1) + ' мкс'],
        ['Уставка защиты по току I<sub>max</sub>', fmt(v.itrip, 1) + ' А']
      ]);
    },
    runs: function (v) {
      var base = { Vdc: v.vdc, R: v.R, L: v.L, traceVar: 'i_meas' };
      var tA = v.tcal + 0.004 + 2 / v.fout, tB = v.tcal + 0.004 + 1 / v.fout, tsc = v.tcal + 0.006;
      return [
        { id: 'A', title: 'номинальный режим', params: Object.assign({}, base, { seed: 2000 + v.n, sense: sensorFor(v, 2000 + v.n), Tsim: tA * 1e3, overrides: { m_index: v.m, f_out: v.fout } }) },
        { id: 'B', title: 'задание с перемодуляцией', params: Object.assign({}, base, { seed: 3000 + v.n, sense: sensorFor(v, 3000 + v.n), Tsim: tB * 1e3, overrides: { m_index: 1.15, f_out: v.fout } }) },
        { id: 'D', title: 'короткое замыкание нагрузки', tsc: tsc, params: Object.assign({}, base, { seed: 4000 + v.n, sense: sensorFor(v, 4000 + v.n), Tsim: (v.tcal + 0.012) * 1e3, overrides: { m_index: v.m, f_out: v.fout }, loadEvents: [{ t: tsc, R: 0.05, L: 0.05 }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'Частота ШИМ', req: function (v) { return fmt(v.fsw / 1000, 3) + ' кГц ± 0,1 %'; }, method: 'По моментам TBCTR = 0 в номинальном режиме.' },
      { id: 'И2', name: 'Момент запуска АЦП', req: function () { return 'TBCTR = TBPRD (середина импульса нижнего ключа) ± 50 нс'; }, method: 'Моменты начала выборки всех преобразований после включения выходов.' },
      { id: 'И3', name: 'Вход и окно выборки', req: function (v) { return 'ADCINA' + v.ch + ', окно не менее ' + v.tSmin + ' нс'; }, method: 'Все преобразования номинального режима.' },
      { id: 'И4', name: 'Режим АЦП', req: function () { return 'ADCCLK не более 50 МГц, 12 бит, пауза после включения не менее 500 мкс, ADCINT1 по окончании преобразования'; }, method: 'Настройка АЦП A до первого преобразования.' },
      { id: 'И5', name: 'Частота вызова обработчика АЦП', req: function (v) { return 'один вызов за период ШИМ, ' + fmt(v.fsw / 1000, 3) + ' кГц ± 0,1 %'; }, method: 'По моментам входа в обработчик ADCA1.' },
      { id: 'И6', name: 'Систематическая погрешность измерения', req: function (v) { return 'не более 0,5 % диапазона, ' + fmt(0.005 * v.ifs * 1000, 0) + ' мА'; }, method: 'Среднее значение разности i_meas и тока фазы в момент выборки после калибровки; смещение нуля датчика 15…40 мВ неизвестного знака.' },
      { id: 'И7', name: 'Погрешность измерения', req: function (v) { return 'не более 2 % диапазона, ' + fmt(0.02 * v.ifs, 3) + ' А'; }, method: 'Наибольшая разность i_meas и тока фазы в момент выборки, номинальный режим.' },
      { id: 'И8', name: 'Погрешность при перемодуляции', req: function (v) { return 'не более 2 % диапазона, ' + fmt(0.02 * v.ifs, 3) + ' А'; }, method: 'То же при m = 1,15.' },
      { id: 'И9', name: 'Время срабатывания защиты по току', req: function (v) { return 'не более двух периодов ШИМ, ' + fmt(2e6 / v.fsw, 0) + ' мкс, от превышения уставки ' + fmt(v.itrip, 1) + ' А'; }, method: 'Короткое замыкание нагрузки через индуктивность 50 мкГн.' },
      { id: 'И10', name: 'Включение выходов и ложные срабатывания', req: function () { return 'выходы отключены на время калибровки, включены после нее и не отключаются без аварии'; }, method: 'Номинальный режим и перемодуляция.' },
      { id: 'И11', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE в каждом вызове, нет переполнения ADCINT1, интерфейсные переменные m_index, f_out, i_meas, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, B = R.B, D = R.D, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      if (!A || A.compileError) { LR2.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + (A ? A.compileError : 'нет результата')); }); return out; }
      var T = HZ / v.fsw, m = A.measures, enA = enableTick(A);
      // И1
      if (!m.fpwm) out['И1'] = bad('счетчик ePWM1 не работает');
      else { var e1 = (m.fpwm - v.fsw) / v.fsw * 100; out['И1'] = res(Math.abs(e1) <= 0.1, fmt(m.fpwm / 1000, 3) + ' кГц (' + (e1 >= 0 ? '+' : '') + fmt(e1, 2) + ' %)'); }
      var tpA = adcTuples(A);
      var tpRun = tpA.filter(function (q) { return enA !== null && q.t0 > enA + T; });
      // И2
      if (!tpA.length) out['И2'] = bad('преобразования АЦП не запускаются');
      else {
        var sel = tpRun.length ? tpRun : tpA, worst = 0, nearZero = 0;
        sel.forEach(function (q) {
          var dp = nearest(A.logs.prdT, q.t0), dz = nearest(A.logs.zeroT, q.t0);
          if (Math.abs(dz) < Math.abs(dp)) nearZero++;
          if (Math.abs(dp) > Math.abs(worst)) worst = dp;
        });
        var ok2 = Math.abs(worst) <= 5;
        out['И2'] = res(ok2, ok2 ? 'при TBCTR = TBPRD, отклонение не более ' + Math.abs(worst) * 10 + ' нс' : (nearZero > sel.length / 2 ? 'запуск при TBCTR = 0, в середине импульса верхнего ключа' : 'отклонение от TBCTR = TBPRD до ' + fmt(Math.abs(worst) * 10 / 1000, 2) + ' мкс'));
      }
      function nearest(arr, t) { var lo = 0, hi = arr.length - 1, best = Infinity; while (lo <= hi) { var mid = (lo + hi) >> 1; var d = t - arr[mid]; if (Math.abs(d) < Math.abs(best)) best = d; if (arr[mid] < t) lo = mid + 1; else hi = mid - 1; } return best === Infinity ? 1e9 : best; }
      // И3
      var tpCh = tpA.filter(function (q) { return q.ch === v.ch; });
      if (!tpCh.length) out['И3'] = bad(tpA.length ? 'оцифровывается вход ADCINA' + tpA[0].ch + ', а датчик подключен к ADCINA' + v.ch : 'преобразований нет');
      else { var twMin = Math.min.apply(null, tpCh.map(function (q) { return q.tw; })); out['И3'] = res(twMin >= v.tSmin, 'ADCINA' + v.ch + ', окно ' + twMin + ' нс'); }
      // И4
      var w4 = [];
      [A, B, D].forEach(function (x) { if (!x || x.compileError) return; if (x.warnKeys.indexOf('adcclk') >= 0) w4.push('ADCCLK выше 50 МГц'); if (x.warnKeys.indexOf('adcready') >= 0) w4.push('преобразование до окончания включения'); if (x.warnKeys.indexOf('acqps') >= 0) w4.push('ACQPS меньше 14'); });
      if (!A.adcModeSet) w4.push('не вызвана AdcSetMode()');
      if (A.snapMain && !((A.snapMain.AdcaRegs.ADCCTL1 >> 2) & 1)) w4.push('ADCINT1 формируется в начале преобразования (INTPULSEPOS = 0), обработчик читает результат предыдущего периода');
      w4 = w4.filter(function (s, i) { return w4.indexOf(s) === i; });
      out['И4'] = !tpA.length ? bad('АЦП не используется') : res(w4.length === 0, w4.length ? w4.join('; ') : 'нарушений нет');
      // И5
      var it = A.logs.isrT;
      if (A.isrBy.adc < 3) out['И5'] = bad(A.isrBy.adc + ' вызовов обработчика АЦП');
      else { var fi = (it.length - 1) / ((it[it.length - 1] - it[0]) / HZ), e5 = (fi - v.fsw) / v.fsw * 100; out['И5'] = res(Math.abs(e5) <= 0.1 && A.isrBy.epwm === 0, fmt(fi / 1000, 3) + ' кГц, ' + A.isrBy.adc + ' вызовов' + (A.isrBy.epwm ? ', также вызывается обработчик ePWM' : '')); }
      // И6, И7
      function errStats(x) {
        if (!x || x.compileError) return null;
        var en = enableTick(x); if (en === null) return { none: 'выходы не включались' };
        if (!x.varsEnd || typeof x.varsEnd.i_meas !== 'number') return { none: 'нет переменной i_meas' };
        var tr = trips(x, en), until = tr.length ? tr[0].t : Infinity;
        var pr = pairs(x, en + 2 * T).filter(function (p) { return p.t < until; });
        if (pr.length < 10) return { none: 'недостаточно измерений после включения выходов' };
        var sum = 0, mx = 0; pr.forEach(function (p) { var e = p.meas - p.tru; sum += e; if (Math.abs(e) > Math.abs(mx)) mx = e; });
        return { mean: sum / pr.length, max: mx, n: pr.length };
      }
      var sA = errStats(A), sB = errStats(B);
      if (!sA || sA.none) { out['И6'] = bad(sA ? sA.none : 'нет данных'); out['И7'] = bad(sA ? sA.none : 'нет данных'); }
      else {
        out['И6'] = res(Math.abs(sA.mean) <= 0.005 * v.ifs, fmt(sA.mean * 1000, 1) + ' мА по ' + sA.n + ' измерениям');
        out['И7'] = res(Math.abs(sA.max) <= 0.02 * v.ifs, fmt(sA.max, 3) + ' А (' + fmt(Math.abs(sA.max) / v.ifs * 100, 2) + ' % диапазона)');
      }
      if (!sB || sB.none) out['И8'] = bad(sB ? sB.none : 'нет данных');
      else out['И8'] = res(Math.abs(sB.max) <= 0.02 * v.ifs, fmt(sB.max, 3) + ' А (' + fmt(Math.abs(sB.max) / v.ifs * 100, 2) + ' % диапазона)');
      // И9
      if (!D || D.compileError) out['И9'] = bad('испытание не проведено');
      else {
        var tsc = Math.round((v.tcal + 0.006) * HZ), Lg = D.logs, tex = null, pk = 0;
        for (var k = Math.floor(tsc / Lg.dec); k < Lg.iN; k++) { var ii = Math.abs(Lg.iS[k]); if (ii > pk) pk = ii; if (tex === null && ii > v.itrip) tex = (k + 1) * Lg.dec; }
        var trD = trips(D, tsc), enD = enableTick(D);
        if (enD === null || enD > tsc) out['И9'] = bad('выходы не были включены к моменту замыкания');
        else if (tex === null) out['И9'] = bad('ток не превысил уставку: выходы отключены раньше замыкания');
        else if (!trD.length) out['И9'] = bad('защита не сработала, ток достиг ' + fmt(pk, 1) + ' А');
        else { var dt9 = (trD[0].t - tex) / HZ; out['И9'] = res(dt9 <= 2 / v.fsw + 1e-6, fmt(Math.max(0, dt9) * 1e6, 1) + ' мкс, пиковый ток ' + fmt(pk, 1) + ' А'); }
      }
      // И10
      var p10 = [];
      [['A', A], ['B', B]].forEach(function (pp) {
        var x = pp[1]; if (!x || x.compileError) return;
        var en = enableTick(x);
        if (en === null) { p10.push(pp[0] + ': выходы не включены'); return; }
        if (en === 0) p10.push(pp[0] + ': выходы не отключены на время калибровки');
        else if (en > (v.tcal * 1.25 + 0.002) * HZ) p10.push(pp[0] + ': выходы включены через ' + fmt(en / HZ * 1e3, 1) + ' мс');
        var tr = trips(x, Math.max(en, 10)); if (tr.length) p10.push(pp[0] + ': отключение при t = ' + fmt(tr[0].t / HZ * 1e3, 2) + ' мс');
      });
      out['И10'] = res(p10.length === 0, p10.length ? p10.join('; ') : 'выходы включены через ' + fmt((enA || 0) / HZ * 1e3, 1) + ' мс, ложных отключений нет');
      // И11
      var viol = [];
      [A, B, D].forEach(function (x) {
        if (!x || x.compileError) return;
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        if (!x.varsEnd || typeof x.varsEnd.i_meas !== 'number') viol.push('нет переменной i_meas');
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И11'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };

  /* ------------------------------------------------------------ */
  /* ЛР3. Контур тока двигателя постоянного тока                  */
  /* ------------------------------------------------------------ */
  var HALL_S = [0.264, 0.132, 0.088, 0.066];   // В/А, питание 3,3 В, нуль 1,65 В
  function r1(x) { return Math.round(x * 10) / 10; }
  function sig2(x) { return +x.toPrecision(2); }
  function lr3Variant(n) {
    var v = lr2Variant(n), r = rng(15485863 * n + 3);
    ['rsh', 'g', 'pol', 'itrip', 'dmax', 'tset', 'i1m', 'ifs'].forEach(function (k) { delete v[k]; });
    v.vdc = pick(r, [24, 36, 48]);
    v.inom = stepIn(r, 4, 12, 0.5);
    v.R = Math.max(0.1, Math.round((0.05 + 0.07 * r()) * v.vdc / v.inom * 100) / 100);
    v.te = stepIn(r, 1.5, 6, 0.5);                                   // мс
    var Lmin = v.vdc / (8 * v.fsw * 0.25 * v.inom) * 1e3;             // пульсации не более 25 % Iном
    v.L = Math.round(Math.max(v.R * v.te, Lmin) / 0.05) * 0.05; v.L = +v.L.toFixed(2);
    v.te = v.L / v.R;
    v.nnom = pick(r, [1500, 2000, 3000]);
    var wnom = v.nnom * Math.PI / 30;
    v.ke = Math.round(0.85 * (v.vdc - v.R * v.inom) / wnom * 1000) / 1000;
    v.tbs = pick(r, [0.5, 1.0, 1.5, 2.0]);                            // мкс
    v.itrip = r1(1.5 * v.inom);
    v.sens = HALL_S[HALL_S.length - 1];
    for (var q = 0; q < HALL_S.length; q++) if (1.65 / HALL_S[q] >= 1.2 * v.itrip) { v.sens = HALL_S[q]; break; }
    v.ifs = 1.65 / v.sens;
    v.pol = r() < 0.5 ? 1 : -1;
    v.bw = pick(r, [80, 120, 250]);                                    // кГц
    v.dt = v.dbTicks * 10e-9;
    v.dmax = 1 - (v.tbs * 1e-6 + v.dt) * v.fsw;
    v.umax = (2 * v.dmax - 1) * v.vdc;
    v.tmu = 1 / v.fsw;
    v.kp = v.L * 1e-3 / (2 * v.tmu); v.ki = v.R / (2 * v.tmu);
    // момент инерции: ошибка от нарастания ЭДС (dE/dt)/KI не более 1,2 % Iном при токе 0,5 Iном
    v.j = sig2(Math.max(v.ke * 0.5 * v.inom * 0.03 / (0.35 * wnom), v.ke * v.ke * 0.5 / (0.012 * v.ki)));
    v.i1 = Math.floor(Math.min(0.3 * v.inom, 0.8 * v.umax / (2 * v.kp + v.R)) * 10) / 10;
    v.tcal = 256 / v.fsw;
    v.t1 = Math.ceil((v.tcal + 0.005) * 1000) / 1000;
    v.tc = Math.round(0.1 * v.ke * v.inom * 1e4) / 1e4;
    return v;
  }
  function hallFor(v, seed) {
    var r = rng(seed * 37 + 11);
    var voff = (0.010 + 0.015 * r()) * (r() < 0.5 ? -1 : 1);
    var gerr = (r() * 2 - 1) * 0.008;
    return { type: 'hall', ch: v.ch, sens: v.sens, pol: v.pol, voff: voff, gerr: gerr, tauAmp: 1 / (2 * Math.PI * v.bw * 1e3), tauS: v.tSmin * 1e-9 / Math.log(8192) };
  }
  // ток, усредненный за период ШИМ: [{t, i}] в моменты TBCTR = 0
  function iAvgPeriods(x) {
    var L = x.logs, z = L.zeroT, out = [], k = 0, dec = L.dec;
    for (var p = 0; p + 1 < z.length; p++) {
      var a = Math.ceil(z[p] / dec), b = Math.floor(z[p + 1] / dec), s = 0, n = 0;
      for (var q = a; q < b && q < L.iN; q++) { s += L.iS[q]; n++; }
      if (n) out.push({ t: (z[p] + z[p + 1]) / 2, i: s / n });
    }
    return out;
  }
  // переходная характеристика по среднему за период току
  function stepResp(av, t0, t1, from, to) {
    var amp = to - from, sg = amp >= 0 ? 1 : -1, ext = null, t90 = null, fin = 0, nf = 0;
    av.forEach(function (p) {
      if (p.t < t0 || p.t > t1) return;
      var rel = (p.i - from) * sg;
      if (ext === null || rel > ext) ext = rel;
      if (t90 === null && rel >= 0.9 * Math.abs(amp)) t90 = p.t - t0;
      if (p.t > t1 - 0.001 * HZ) { fin += p.i; nf++; }
    });
    return { over: ext === null ? NaN : (ext / Math.abs(amp) - 1) * 100, t90: t90 === null ? null : t90 / HZ, fin: nf ? fin / nf : NaN };
  }
  function edgesHigh(ed, from, to) {     // [{a, b}] интервалы высокого уровня
    var o = [], st = null, lv = levelAt(ed, from);
    if (lv === 1) st = from;
    for (var k = 0; k < ed.length; k += 2) {
      if (ed[k] <= from) continue; if (ed[k] > to) break;
      if (ed[k + 1] === 1 && st === null) st = ed[k];
      else if (ed[k + 1] === 0 && st !== null) { o.push({ a: st, b: ed[k] }); st = null; }
    }
    if (st !== null) o.push({ a: st, b: to });
    return o;
  }
  function vmFractions(x, from, to, ud) {   // доли времени vm > Ud/2 и vm < -Ud/2
    var ve = x.logs.vEd, pos = 0, neg = 0, lv = 0;
    for (var k = 0; k < ve.length; k += 2) {
      var t = ve[k], nx = k + 2 < ve.length ? ve[k + 2] : x.endTick;
      var a = Math.max(t, from), b = Math.min(nx, to);
      if (b > a) { if (ve[k + 1] > ud / 2) pos += b - a; else if (ve[k + 1] < -ud / 2) neg += b - a; }
    }
    return { pos: pos / (to - from), neg: neg / (to - from) };
  }

  var LR3 = {
    id: 'lr3', no: 3,
    title: 'Контур тока двигателя постоянного тока',
    variants: 30,
    variant: lr3Variant,
    interfaceVars: ['i_ref', 'i_meas'],
    sense: function (v) { return hallFor(v, 1); },
    trace: 'i_meas',
    demo: function (v) { var p = LR3.runs(v)[0].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), Tsim: p.Tsim }; },
    describe: function (v) {
      return [
        ['Частота ШИМ f<sub>ШИМ</sub>', fmt(v.fsw / 1000, 1) + ' кГц'],
        ['Мертвое время (по данным ЛР1)', 'не менее ' + v.dtReq + ' нс'],
        ['Вход сигнала аварии драйверов nFAULT', 'GPIO' + v.gpio + ', открытый сток, общий для обеих стоек'],
        ['Напряжение звена постоянного тока U<sub>d</sub>', v.vdc + ' В'],
        ['Двигатель: номинальный ток I<sub>ном</sub>', fmt(v.inom, 1) + ' А'],
        ['Двигатель: сопротивление якоря R<sub>я</sub>', fmt(v.R, 2) + ' Ом'],
        ['Двигатель: индуктивность якоря L<sub>я</sub>', fmt(v.L, 2) + ' мГн'],
        ['Двигатель: k<sub>Е</sub> = k<sub>М</sub>, момент инерции J', fmt(v.ke, 3) + ' В·с/рад, ' + String(v.j).replace('.', ',') + ' кг·м²'],
        ['Датчик тока', 'на эффекте Холла, ' + fmt(v.sens * 1000, 0) + ' мВ/А, нулевой уровень 1,65 В, полоса ' + v.bw + ' кГц'],
        ['Включение датчика', v.pol > 0 ? 'напряжение растет при токе от стойки A к стойке B' : 'напряжение убывает при токе от стойки A к стойке B'],
        ['Вход АЦП, минимальное окно выборки', 'ADCINA' + v.ch + ', ' + v.tSmin + ' нс'],
        ['Наименьший импульс нижнего ключа t<sub>bs</sub>', fmt(v.tbs, 1) + ' мкс (заряд бутстрепного конденсатора)'],
        ['Уставка защиты по току I<sub>max</sub>', fmt(v.itrip, 1) + ' А'],
        ['Испытательные скачки задания', '±' + fmt(v.i1, 1) + ' А и ' + fmt(v.inom, 1) + ' А, начало при t = ' + fmt(v.t1 * 1000, 0) + ' мс']
      ];
    },
    runs: function (v) {
      var mot = { ke: v.ke, km: v.ke, j: v.j, b: 0, tc: v.tc, tload: 0, locked: true };
      function base(seed, extra) { return Object.assign({ plant: 'hbdc', Vdc: v.vdc, R: v.R, L: v.L, traceVar: 'i_meas', seed: seed, sense: hallFor(v, seed), motor: Object.assign({}, mot) }, extra); }
      var t1 = v.t1, sm = [{ t: t1, name: 'i_ref', value: v.i1 }, { t: t1 + 0.005, name: 'i_ref', value: -v.i1 }];
      return [
        { id: 'A', title: 'малые скачки задания', params: base(5000 + v.n, { Tsim: (t1 + 0.010) * 1e3, varEvents: sm }) },
        { id: 'B', title: 'отклонение параметров якоря', params: base(6000 + v.n, { R: +(v.R * 1.3).toFixed(4), L: +(v.L * 0.75).toFixed(4), Tsim: (t1 + 0.010) * 1e3, varEvents: sm }) },
        { id: 'C', title: 'скачок до номинального тока', params: base(7000 + v.n, { Tsim: (t1 + 0.020) * 1e3, varEvents: [{ t: t1, name: 'i_ref', value: v.inom }, { t: t1 + 0.012, name: 'i_ref', value: 0 }] }) },
        { id: 'D', title: 'пуск двигателя', params: base(8000 + v.n, { Tsim: (t1 + 0.030) * 1e3, motor: Object.assign({}, mot, { locked: false }), varEvents: [{ t: t1, name: 'i_ref', value: r1(0.5 * v.inom) }] }) },
        { id: 'G', title: 'насыщение регулятора при разгоне', tg: lr3TRev(v), params: base(9700 + v.n, { Tsim: (lr3TRev(v) + 0.008) * 1e3, motor: Object.assign({}, mot, { locked: false }), varEvents: [{ t: t1, name: 'i_ref', value: v.inom }, { t: lr3TRev(v), name: 'i_ref', value: -v.inom }] }) },
        { id: 'E', title: 'задание тока выше уставки защиты', params: base(9000 + v.n, { Tsim: (t1 + 0.008) * 1e3, varEvents: [{ t: t1, name: 'i_ref', value: v.i1 }, { t: t1 + 0.003, name: 'i_ref', value: r1(1.25 * v.itrip) }] }) },
        { id: 'F', title: 'сигнал аварии драйвера', params: base(9500 + v.n, { Tsim: (t1 + 0.005) * 1e3, varEvents: [{ t: t1, name: 'i_ref', value: v.i1 }], faults: [{ pin: v.gpio, t0: t1 + 0.002, t1: t1 + 0.00202 }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'Частота ШИМ и синхронизация стоек', req: function (v) { return fmt(v.fsw / 1000, 3) + ' кГц ± 0,1 %, расхождение счетчиков ePWM1 и ePWM2 не более 10 нс'; }, method: 'По моментам TBCTR = 0 обоих модулей в режиме A.' },
      { id: 'И2', name: 'Мертвое время и сквозной ток', req: function (v) { return 'от ' + v.dtReq + ' до ' + (v.dtReq + 100) + ' нс в обеих стойках, ключи стойки не открыты одновременно'; }, method: 'Все переключения режима A; сквозной ток во всех режимах.' },
      { id: 'И3', name: 'Однополярная модуляция', req: function (v) { return 'при положительном токе напряжение на якоре принимает значения 0 и +U<sub>d</sub>; обратная полярность не более ' + fmt((4 * v.dt * v.fsw + 0.01) * 100, 1) + ' % времени (интервалы мертвого времени)'; }, method: 'Режим A, интервал установившегося тока +' + 'I<sub>1</sub>.' },
      { id: 'И4', name: 'Измерительный канал', req: function (v) { return 'запуск АЦП при TBCTR = TBPRD ePWM1 ± 50 нс, ADCINA' + v.ch + ', окно не менее ' + v.tSmin + ' нс, ADCCLK не более 50 МГц, один вызов обработчика за период'; }, method: 'Все преобразования и вызовы обработчика режима A после включения выходов.' },
      { id: 'И5', name: 'Погрешность измерения тока', req: function (v) { return 'систематическая не более 0,5 % диапазона (' + fmt(0.005 * v.ifs * 1000, 0) + ' мА), наибольшая не более 2 % (' + fmt(0.02 * v.ifs, 2) + ' А)'; }, method: 'Разность i_meas и тока якоря в момент выборки, режим A; смещение нуля датчика 10…25 мВ неизвестного знака.' },
      { id: 'И6', name: 'Переходная характеристика контура тока', req: function (v) { return 'перерегулирование не более 10 %, время нарастания до 0,9 не более 5 T<sub>ШИМ</sub> = ' + fmt(5e6 / v.fsw, 0) + ' мкс'; }, method: 'Режим A: скачки задания 0 → ' + '+I<sub>1</sub> и +I<sub>1</sub> → −I<sub>1</sub>, ротор заторможен; ток якоря, усредненный за период ШИМ.' },
      { id: 'И7', name: 'Установившаяся ошибка', req: function (v) { return 'не более 2 % I<sub>ном</sub>, ' + fmt(0.02 * v.inom * 1000, 0) + ' мА'; }, method: 'Режим A: среднее значение тока якоря за последнюю 1 мс каждого скачка.' },
      { id: 'И8', name: 'Отклонение параметров якоря', req: function () { return 'перерегулирование не более 20 %, установившаяся ошибка не более 2 % I<sub>ном</sub>'; }, method: 'Режим B: R<sub>я</sub> больше расчетного на 30 %, L<sub>я</sub> меньше на 25 %.' },
      { id: 'И9', name: 'Большой скачок задания', req: function (v) { return 'перерегулирование не более 10 %, время нарастания до 0,9 I<sub>ном</sub> не более ' + fmt(lr3TLim(v) * 1e6, 0) + ' мкс, без отключения защиты'; }, method: 'Режим C: скачки 0 → I<sub>ном</sub> → 0, напряжение регулятора достигает ограничения.' },
      { id: 'И10', name: 'Выход из насыщения регулятора', req: function (v) { return 'после смены задания с I<sub>ном</sub> на −I<sub>ном</sub> ток достигает −0,9 I<sub>ном</sub> не позднее ' + fmt(lr3TRevLim(v) * 1e6, 0) + ' мкс'; }, method: 'Режим G: ротор свободен, задание I<sub>ном</sub>; двигатель разгоняется до выхода напряжения регулятора на ограничение, после чего задание меняется на −I<sub>ном</sub> (торможение).' },
      { id: 'И11', name: 'Ограничение напряжения', req: function (v) { return 'импульс нижнего ключа каждой стойки в каждом периоде не короче t<sub>bs</sub> = ' + fmt(v.tbs, 1) + ' мкс'; }, method: 'Режимы A, B, C, D после включения выходов.' },
      { id: 'И12', name: 'Работа с вращающимся двигателем', req: function (v) { return 'ошибка тока не более 3 % I<sub>ном</sub>, ' + fmt(0.03 * v.inom * 1000, 0) + ' мА, при нарастании ЭДС'; }, method: 'Режим D: ротор свободен, задание 0,5 I<sub>ном</sub>; ток якоря, усредненный за период, после окончания переходного процесса.' },
      { id: 'И13', name: 'Включение выходов и защита по току', req: function (v) { return 'выходы обеих стоек отключены при калибровке и включены до t = ' + fmt((v.t1 - 0.001) * 1000, 0) + ' мс, нет ложных отключений; ток якоря не превышает уставку ' + fmt(v.itrip, 1) + ' А или обе стойки отключаются не позднее двух периодов ШИМ после превышения'; }, method: 'Режимы A, B, C, D; режим E: задание ' + '1,25 I<sub>max</sub> от вышестоящего контура, ток якоря усреднен за период ШИМ.' },
      { id: 'И14', name: 'Аварийный сигнал драйверов', req: function () { return 'все четыре ключа закрыты не позднее 0,2 мкс после появления сигнала и остаются закрытыми'; }, method: 'Режим F: импульс низкого уровня 20 мкс на входе nFAULT.' },
      { id: 'И15', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE в каждом вызове, нет переполнения ADCINT1, интерфейсные переменные i_ref и i_meas, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, B = R.B, Cc = R.C, D = R.D, E = R.E, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      if (!A || A.compileError) { LR3.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + (A ? A.compileError : 'нет результата')); }); return out; }
      var T = HZ / v.fsw, t1 = Math.round(v.t1 * HZ), m = A.measures;
      function live(x) { return x && !x.compileError; }
      function nearest(arr, t) { var lo = 0, hi = arr.length - 1, best = Infinity; while (lo <= hi) { var mid = (lo + hi) >> 1; var d = t - arr[mid]; if (Math.abs(d) < Math.abs(best)) best = d; if (arr[mid] < t) lo = mid + 1; else hi = mid - 1; } return best === Infinity ? 1e9 : best; }
      function enT(x) { return enableTick(x); }
      function switching(x, from, to) { var n = 0; [x.logs.ed[0], x.logs.ed[1]].forEach(function (ed) { if (!ed) return; [ed.A, ed.B].forEach(function (e) { for (var k = 0; k < e.length; k += 2) if (e[k] >= from && e[k] <= to) n++; }); }); return n; }
      // И1
      if (!m.fpwm) out['И1'] = bad('счетчик ePWM1 не работает');
      else {
        var e1 = (m.fpwm - v.fsw) / v.fsw * 100, z2 = A.logs.zeroT2, worst = 0;
        if (z2.length < 3) out['И1'] = bad(fmt(m.fpwm / 1000, 3) + ' кГц; счетчик ePWM2 не работает');
        else {
          var sel = z2.slice(-200); sel.forEach(function (t) { var d = nearest(A.logs.zeroT, t); if (Math.abs(d) > Math.abs(worst)) worst = d; });
          var f2 = (z2.length - 1) / ((z2[z2.length - 1] - z2[0]) / HZ);
          var ok1 = Math.abs(e1) <= 0.1 && Math.abs(worst) <= 1;
          out['И1'] = res(ok1, fmt(m.fpwm / 1000, 3) + ' кГц (' + (e1 >= 0 ? '+' : '') + fmt(e1, 2) + ' %), ' + (Math.abs(worst) <= 1 ? 'счетчики синхронны' : (Math.abs(f2 - m.fpwm) > 1 ? 'частота ePWM2 ' + fmt(f2 / 1000, 3) + ' кГц' : 'сдвиг счетчиков ' + fmt(Math.abs(worst) * 10 / 1000, 2) + ' мкс')));
        }
      }
      // И2
      var dts = [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA]], p2 = [], dmn = Infinity, dmx = 0;
      dts.forEach(function (d) {
        if (!d[1] || !d[2]) { p2.push('стойка ' + d[0] + ': нет переключений'); return; }
        var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9;
        dmn = Math.min(dmn, mn); dmx = Math.max(dmx, mx);
        if (mn < v.dtReq - 0.5 || mx > v.dtReq + 100.5) p2.push('стойка ' + d[0] + ': ' + Math.round(mn) + '…' + Math.round(mx) + ' нс');
      });
      var shN = 0; [A, B, Cc, D, E, R.F, R.G].forEach(function (x) { if (live(x)) shN += x.measures.shootN; });
      if (shN) p2.push('сквозной ток: ' + shN + ' раз');
      out['И2'] = res(p2.length === 0, p2.length ? p2.join('; ') : Math.round(dmn) + '…' + Math.round(dmx) + ' нс, сквозного тока нет');
      // И3
      var enA = enT(A), from3 = t1 + 0.002 * HZ, to3 = t1 + 0.005 * HZ;
      if (enA === null || enA > from3) out['И3'] = bad('выходы не включены');
      else {
        var fr = vmFractions(A, from3, to3, v.vdc), lim3 = 4 * v.dt * v.fsw + 0.01;
        out['И3'] = res(fr.neg <= lim3 && fr.pos > 0, 'обратная полярность ' + fmt(fr.neg * 100, 1) + ' % времени' + (fr.neg > 0.2 ? ' (двухполярная модуляция)' : '') + ', +U<sub>d</sub> ' + fmt(fr.pos * 100, 1) + ' %');
        out['И3'].meas = out['И3'].meas.replace('<sub>d</sub>', 'd');
      }
      // И4
      var tp = adcTuples(A), w4 = [];
      var tpRun = tp.filter(function (q) { return enA !== null && q.t0 > enA + T; });
      if (!tp.length) w4.push('преобразования АЦП не запускаются');
      else {
        var sel4 = tpRun.length ? tpRun : tp, wst = 0, nz = 0;
        sel4.forEach(function (q) { var dp = nearest(A.logs.prdT, q.t0), dz = nearest(A.logs.zeroT, q.t0); if (Math.abs(dz) < Math.abs(dp)) nz++; if (Math.abs(dp) > Math.abs(wst)) wst = dp; });
        if (Math.abs(wst) > 5) w4.push(nz > sel4.length / 2 ? 'запуск АЦП при TBCTR = 0' : 'запуск АЦП со сдвигом до ' + fmt(Math.abs(wst) * 10 / 1000, 2) + ' мкс от TBCTR = TBPRD');
        var tch = tp.filter(function (q) { return q.ch === v.ch; });
        if (!tch.length) w4.push('оцифровывается ADCINA' + tp[0].ch + ' вместо ADCINA' + v.ch);
        else { var twm = Math.min.apply(null, tch.map(function (q) { return q.tw; })); if (twm < v.tSmin) w4.push('окно выборки ' + twm + ' нс'); }
      }
      [A, B, Cc, D, E].forEach(function (x) { if (!live(x)) return; if (x.warnKeys.indexOf('adcclk') >= 0) w4.push('ADCCLK выше 50 МГц'); if (x.warnKeys.indexOf('adcready') >= 0) w4.push('преобразование до окончания включения АЦП'); });
      if (A.snapMain && !((A.snapMain.AdcaRegs.ADCCTL1 >> 2) & 1)) w4.push('INTPULSEPOS = 0');
      var it = A.logs.isrT;
      if (A.isrBy.adc < 3) w4.push(A.isrBy.adc + ' вызовов обработчика АЦП');
      else { var fi = (it.length - 1) / ((it[it.length - 1] - it[0]) / HZ); if (Math.abs(fi - v.fsw) / v.fsw > 0.001) w4.push('частота вызова обработчика ' + fmt(fi / 1000, 3) + ' кГц'); }
      w4 = w4.filter(function (s, i) { return w4.indexOf(s) === i; });
      out['И4'] = res(w4.length === 0, w4.length ? w4.join('; ') : 'нарушений нет, ' + A.isrBy.adc + ' вызовов');
      // И5
      if (enA === null) out['И5'] = bad('выходы не включались');
      else if (!A.varsEnd || typeof A.varsEnd.i_meas !== 'number') out['И5'] = bad('нет переменной i_meas');
      else {
        var tr = trips(A, enA), until = tr.length ? tr[0].t : Infinity;
        var pr = pairs(A, enA + 2 * T).filter(function (p) { return p.t < until; });
        if (pr.length < 10) out['И5'] = bad('недостаточно измерений');
        else {
          var sm5 = 0, mx5 = 0; pr.forEach(function (p) { var e = p.meas - p.tru; sm5 += e; if (Math.abs(e) > Math.abs(mx5)) mx5 = e; });
          sm5 /= pr.length;
          out['И5'] = res(Math.abs(sm5) <= 0.005 * v.ifs && Math.abs(mx5) <= 0.02 * v.ifs, 'систематическая ' + fmt(sm5 * 1000, 0) + ' мА, наибольшая ' + fmt(mx5, 3) + ' А');
        }
      }
      // переходные характеристики
      function respA(x) {
        if (!live(x)) return null;
        var av = iAvgPeriods(x), t2 = t1 + 0.005 * HZ, te = t2 + 0.005 * HZ;
        return { s1: stepResp(av, t1, t2, 0, v.i1), s2: stepResp(av, t2, te, v.i1, -v.i1) };
      }
      function tripsAfter(x, from) { var en = enT(x); return en === null ? [] : trips(x, Math.max(en, from)); }
      var rA = respA(A), trA = tripsAfter(A, 10);
      // И6
      if (!rA || trA.length && trA[0].t < t1 + 0.010 * HZ) out['И6'] = bad(trA.length ? 'отключение защиты при t = ' + fmt(trA[0].t / HZ * 1000, 2) + ' мс' : 'нет данных');
      else {
        var ov6 = Math.max(rA.s1.over, rA.s2.over), tr6 = rA.s1.t90, tr6b = rA.s2.t90, lim6 = 5 / v.fsw;
        var ok6 = ov6 <= 10 && tr6 !== null && tr6 <= lim6 && tr6b !== null && tr6b <= lim6;
        out['И6'] = res(ok6, 'перерегулирование ' + fmt(rA.s1.over, 1) + ' % и ' + fmt(rA.s2.over, 1) + ' %, время нарастания ' + (tr6 === null ? 'не достигнуто' : fmt(tr6 * 1e6, 0) + ' мкс') + ' и ' + (tr6b === null ? 'не достигнуто' : fmt(tr6b * 1e6, 0) + ' мкс'));
      }
      // И7
      if (!rA || trA.length) out['И7'] = bad(rA ? 'отключение защиты' : 'нет данных');
      else {
        var e7a = rA.s1.fin - v.i1, e7b = rA.s2.fin + v.i1, e7 = Math.abs(e7a) > Math.abs(e7b) ? e7a : e7b;
        out['И7'] = res(Math.abs(e7) <= 0.02 * v.inom, fmt(e7a * 1000, 0) + ' мА и ' + fmt(e7b * 1000, 0) + ' мА');
      }
      // И8
      var rB = respA(B), trB = live(B) ? tripsAfter(B, 10) : [];
      if (!rB) out['И8'] = bad('нет данных');
      else if (trB.length) out['И8'] = bad('отключение защиты при t = ' + fmt(trB[0].t / HZ * 1000, 2) + ' мс');
      else {
        var ov8 = Math.max(rB.s1.over, rB.s2.over), e8 = Math.max(Math.abs(rB.s1.fin - v.i1), Math.abs(rB.s2.fin + v.i1));
        out['И8'] = res(ov8 <= 20 && e8 <= 0.02 * v.inom, 'перерегулирование ' + fmt(rB.s1.over, 1) + ' % и ' + fmt(rB.s2.over, 1) + ' %, ошибка ' + fmt(e8 * 1000, 0) + ' мА');
      }
      // И9
      if (!live(Cc)) out['И9'] = bad('нет данных');
      else {
        var trC = tripsAfter(Cc, 10);
        if (trC.length) out['И9'] = bad('отключение защиты при t = ' + fmt(trC[0].t / HZ * 1000, 2) + ' мс, ток ' + fmt(Cc.measures.imax, 1) + ' А');
        else {
          var avC = iAvgPeriods(Cc), t2c = t1 + 0.012 * HZ, tec = t1 + 0.020 * HZ;
          var c1 = stepResp(avC, t1, t2c, 0, v.inom), c2 = stepResp(avC, t2c, tec, v.inom, 0), tl = lr3TLim(v);
          var ov9 = Math.max(c1.over, c2.over), e9 = Math.max(Math.abs(c1.fin - v.inom), Math.abs(c2.fin));
          var ok9 = ov9 <= 10 && c1.t90 !== null && c1.t90 <= tl && e9 <= 0.02 * v.inom;
          out['И9'] = res(ok9, 'перерегулирование ' + fmt(c1.over, 1) + ' % и ' + fmt(c2.over, 1) + ' %, время нарастания ' + (c1.t90 === null ? 'не достигнуто' : fmt(c1.t90 * 1e6, 0) + ' мкс') + ', ошибка ' + fmt(e9 * 1000, 0) + ' мА');
        }
      }
      // И10 (режим G)
      var G = R.G;
      if (!live(G)) out['И10'] = bad('нет данных');
      else {
        var tg = Math.round(lr3TRev(v) * HZ), trG = tripsAfter(G, 10), tr10 = null, satT = 0, avG = iAvgPeriods(G);
        avG.forEach(function (p) { if (p.t > t1 + 0.003 * HZ && p.t < tg && p.i < 0.9 * v.inom) satT += T; if (tr10 === null && p.t > tg && p.i <= -0.9 * v.inom) tr10 = (p.t - tg) / HZ; });
        if (trG.length) out['И10'] = bad('отключение защиты при t = ' + fmt(trG[0].t / HZ * 1000, 2) + ' мс');
        else if (enT(G) === null || switching(G, t1, t1 + 0.002 * HZ) < 8) out['И10'] = bad('стойки не переключаются');
        else out['И10'] = res(tr10 !== null && tr10 <= lr3TRevLim(v), (tr10 === null ? 'ток не достиг −0,9 Iном' : 'время ' + fmt(tr10 * 1e6, 0) + ' мкс') + ', ток ниже задания из-за ограничения напряжения ' + fmt(satT / HZ * 1000, 1) + ' мс до смены задания');
      }
      // И11
      var p10 = [], minLow = Infinity;
      [['A', A], ['B', B], ['C', Cc], ['D', D]].forEach(function (pp) {
        var x = pp[1]; if (!live(x)) return;
        var en = enT(x); if (en === null) return;
        var tr = trips(x, Math.max(en, 10)), to = tr.length ? tr[0].t : x.endTick, z = x.logs.zeroT, miss = 0;
        [0, 1].forEach(function (mi) {
          var ed = x.logs.ed[mi]; if (!ed) return;
          var hi = edgesHigh(ed.B, en + T, to - T);
          var k = 0;
          for (var p = 0; p + 1 < z.length; p++) {
            if (z[p] < en + 2 * T || z[p + 1] > to - T) continue;
            var w = 0; while (k < hi.length && hi[k].b <= z[p]) k++;
            for (var q = k; q < hi.length && hi[q].a < z[p + 1]; q++) w = Math.max(w, Math.min(hi[q].b, z[p + 1]) - Math.max(hi[q].a, z[p]));
            if (w < minLow) minLow = w;
            if (w < v.tbs * 100 - 0.5) miss++;
          }
        });
        if (miss) p10.push(pp[0] + ': ' + miss + ' периодов с коротким импульсом или без импульса нижнего ключа');
      });
      out['И11'] = res(p10.length === 0 && isFinite(minLow), p10.length ? p10.join('; ') + ', наименьший импульс ' + fmt(minLow / 100, 2) + ' мкс' : (isFinite(minLow) ? 'наименьший импульс ' + fmt(minLow / 100, 2) + ' мкс' : 'нет данных'));
      // И11
      if (!live(D)) out['И12'] = bad('нет данных');
      else {
        var trD = tripsAfter(D, 10), iD = r1(0.5 * v.inom);
        if (enT(D) === null || switching(D, t1, t1 + 0.002 * HZ) < 8) out['И12'] = bad('стойки не переключаются');
        else if (trD.length) out['И12'] = bad('отключение защиты при t = ' + fmt(trD[0].t / HZ * 1000, 2) + ' мс');
        else {
          var avD = iAvgPeriods(D), e11 = 0;
          avD.forEach(function (p) { if (p.t > t1 + 0.003 * HZ) { var e = p.i - iD; if (Math.abs(e) > Math.abs(e11)) e11 = e; } });
          var wEnd = D.logs.wS ? D.logs.wS[D.logs.iN - 1] : 0;
          out['И12'] = res(Math.abs(e11) <= 0.03 * v.inom, 'наибольшая ошибка ' + fmt(e11 * 1000, 0) + ' мА, частота вращения в конце ' + fmt(wEnd * 30 / Math.PI, 0) + ' об/мин, ЭДС ' + fmt(v.ke * wEnd, 1) + ' В');
        }
      }
      // И12
      var p12 = [];
      [['A', A], ['B', B], ['C', Cc], ['D', D]].forEach(function (pp) {
        var x = pp[1]; if (!live(x)) return;
        var en = enT(x);
        if (en === null) { p12.push(pp[0] + ': выходы не включены'); return; }
        if (en === 0) p12.push(pp[0] + ': выходы не отключены на время калибровки');
        else if (en > t1 - 0.001 * HZ) p12.push(pp[0] + ': выходы включены через ' + fmt(en / HZ * 1e3, 1) + ' мс');
        var b2 = x.logs.ed[1] ? x.logs.ed[1].B : null;
        if (b2 && en > 0) { var hb = edgesHigh(x.logs.ed[1].A, 10, en - 10).concat(edgesHigh(b2, 10, en - 10)); if (hb.length) p12.push(pp[0] + ': стойка B не отключена на время калибровки'); }
      });
      [['A', A], ['B', B], ['C', Cc], ['D', D]].forEach(function (pp) { var x = pp[1]; if (!live(x)) return; var tr = tripsAfter(x, 10); if (tr.length && out['И6'] && pp[0] !== 'C') p12.push(pp[0] + ': отключение при t = ' + fmt(tr[0].t / HZ * 1e3, 2) + ' мс'); });
      var e12ok = '';
      if (!live(E)) p12.push('E: испытание не проведено');
      else {
        var tsc = Math.round((v.t1 + 0.003) * HZ), Lg = E.logs, tex = null, pk = 0, pkAv = 0;
        for (var k = Math.floor(tsc / Lg.dec); k < Lg.iN; k++) { var ii = Math.abs(Lg.iS[k]); if (ii > pk) pk = ii; }
        iAvgPeriods(E).forEach(function (p) { if (p.t > tsc) { pkAv = Math.max(pkAv, Math.abs(p.i)); if (tex === null && Math.abs(p.i) > v.itrip) tex = Math.round(p.t - T / 2); } });
        var enE = enT(E);
        if (enE === null || enE > tsc) p12.push('E: выходы не были включены');
        else if (tex === null) { var trE = trips(E, enE); if (trE.length && trE[0].t < tsc) p12.push('E: отключение до изменения задания'); else e12ok = 'задание ограничено, ток не более ' + fmt(pkAv, 1) + ' А'; }
        else {
          var offT = null, eds = [Lg.ed[0].A, Lg.ed[0].B, Lg.ed[1].A, Lg.ed[1].B];
          for (var tt = tex; tt <= E.endTick; tt += 10) { if (eds.every(function (e) { return levelAt(e, tt) !== 1 && edgesHigh(e, tt, E.endTick).length === 0; })) { offT = tt; break; } }
          if (offT === null) p12.push('E: защита не отключила обе стойки, ток ' + fmt(pk, 1) + ' А');
          else { var d12 = (offT - tex) / HZ; if (d12 > 2 / v.fsw + 1e-6) p12.push('E: отключение через ' + fmt(d12 * 1e6, 0) + ' мкс'); else e12ok = 'отключение обеих стоек через ' + fmt(Math.max(0, d12) * 1e6, 0) + ' мкс после превышения, пиковый ток ' + fmt(pk, 1) + ' А'; }
        }
      }
      out['И13'] = res(p12.length === 0, p12.length ? p12.join('; ') : 'выходы включены через ' + fmt((enA || 0) / HZ * 1e3, 1) + ' мс; ' + e12ok);
      // И13
      var F = R.F;
      if (!live(F)) out['И14'] = bad('нет данных');
      else {
        var tf = Math.round((v.t1 + 0.002) * HZ), enF = enT(F), edF = [F.logs.ed[0].A, F.logs.ed[0].B, F.logs.ed[1].A, F.logs.ed[1].B];
        if (enF === null || enF > tf || switching(F, tf - 2 * T, tf) < 8) out['И14'] = bad('стойки не переключались до появления сигнала');
        else {
          var bads = [], worst13 = 0;
          [['A', 0], ['B', 1]].forEach(function (lg) {
            var ed = F.logs.ed[lg[1]], offAll = 0, ok = true;
            [ed.A, ed.B].forEach(function (e) {
              var off = levelAt(e, tf) === 1 ? null : tf;
              for (var k = 0; k < e.length; k += 2) { if (e[k] < tf) continue; if (e[k + 1] === 1) { ok = false; } else if (off === null) off = e[k]; }
              if (off === null) ok = false; else offAll = Math.max(offAll, off - tf);
            });
            if (!ok) bads.push('стойка ' + lg[0] + ' не отключена сигналом аварии'); else if (offAll > 20) bads.push('стойка ' + lg[0] + ' отключена через ' + fmt(offAll * 10 / 1000, 2) + ' мкс');
            worst13 = Math.max(worst13, offAll);
          });
          out['И14'] = res(bads.length === 0, bads.length ? bads.join('; ') : 'все ключи закрыты через ' + fmt(worst13 * 10 / 1000, 2) + ' мкс и остаются закрытыми');
        }
      }
      // И13
      var viol = [];
      [A, B, Cc, D, E, R.F, R.G].forEach(function (x) {
        if (!live(x)) return;
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        if (!x.varsEnd || typeof x.varsEnd.i_meas !== 'number') viol.push('нет переменной i_meas');
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И15'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };
  // предельное время нарастания при большом скачке: ограничение напряжения плюс запаздывание
  // момент смены задания в режиме G: выход на ограничение напряжения плюс 10 мс
  function lr3TRev(v) { var tsat = 1.2 * v.j * (v.umax - v.R * v.inom) / (v.ke * v.ke * v.inom); return Math.ceil((v.t1 + tsat + 0.010) * 1000) / 1000; }
  function lr3TRevLim(v) { return 2 * v.L * 1e-3 * 1.9 * v.inom / v.umax + 5 / v.fsw; }
  function lr3TLim(v) { var i9 = 0.9 * v.inom; return 1.3 * v.L * 1e-3 * i9 / (v.umax - v.R * i9) + 3 / v.fsw; }

  /* ------------------------------------------------------------ */
  /* ЛР4. Контур скорости с инкрементальным энкодером             */
  /* ------------------------------------------------------------ */
  var ENC_L = [1000, 1024, 2000, 2048, 2500];
  function lr4Variant(n) {
    var v = lr3Variant(n), r = rng(32452843 * n + 5);
    v.lines = pick(r, ENC_L);
    var ns = [4, 5, 8, 10, 16, 20].filter(function (k) { var f = v.fsw / k; return f >= 999 && f <= 2001; });
    v.nspd = pick(r, ns);
    v.tspd = v.nspd / v.fsw;
    v.kj = stepIn(r, 0.5, 2.0, 0.25);
    v.jsum = sig2(v.j * (1 + v.kj));
    v.mnom = v.ke * v.inom;
    v.ilim = r1(1.25 * v.inom);
    v.cpr = 4 * v.lines;
    v.tmuw = 2 * v.tmu + v.tspd;
    v.kpw = v.jsum / (2 * v.ke * v.tmuw); v.kiw = v.kpw / (4 * v.tmuw);
    v.dnq = 60 / (v.cpr * v.tspd);                                   // цена импульса М-метода, об/мин
    v.nmin = Math.max(10, Math.round(5 * v.dnq / 5) * 5);             // низкая скорость: n_мин = 2,5 dn_кв, два-три импульса за период контура скорости
    v.mload = Math.round(0.5 * v.mnom * 1000) / 1000;
    v.qerr = stepIn(r, 0.08, 0.20, 0.01);                            // ошибка фазы каналов A, B в долях импульса
    v.lerr = 0.015;
    v.ecc = 1e-4;
    v.upps = 0;
    v.thold = 0.02;
    var tedge = 4 * 60 / (v.cpr / 2 * v.nmin);                         // интервал между импульсами при nмин/4
    v.ccps = Math.max(0, Math.ceil(Math.log2(tedge * 200e6 / 65536)));
    v.wnom = v.nnom * Math.PI / 30;
    return v;
  }

  function lr4Fin(v) {
    v.t1 = Math.ceil((v.tcal + 0.03) * 1000) / 1000;
    v.n0 = Math.round(0.3 * v.nnom / 10) * 10;
    var dw = 0.5 * v.ilim * v.ke * v.tmuw / (0.25 * v.jsum);
    v.dn = Math.max(10, Math.floor(dw * 30 / Math.PI / 5) * 5);
    v.nb = Math.round(0.5 * v.nnom / 10) * 10;
    v.nrev = Math.round(0.3 * v.nnom / 10) * 10;
    v.tacc = v.jsum * v.wnom / (v.ke * v.ilim - v.tc);
    v.dropTh = 1.77 * v.mload * v.tmuw / v.jsum * 30 / Math.PI;     // оценка провала скорости, об/мин
    return v;
  }
  function lr4V(n) { return lr4Fin(lr4Variant(n)); }
  function encFor(v, seed) { return { lines: v.lines, qerr: v.qerr, lerr: v.lerr, ecc: v.ecc, seed: seed }; }
  // скорость, усредненная за период ШИМ, об/мин: [{t, n, i}]
  function nAvgPeriods(x) {
    var L = x.logs, z = L.zeroT, out = [], dec = L.dec;
    for (var p = 0; p + 1 < z.length; p++) {
      var a = Math.ceil(z[p] / dec), b = Math.floor(z[p + 1] / dec), s = 0, si = 0, n = 0;
      for (var q = a; q < b && q < L.iN; q++) { s += L.wS[q]; si += L.iS[q]; n++; }
      if (n) out.push({ t: (z[p] + z[p + 1]) / 2, n: s / n * 30 / Math.PI, i: si / n });
    }
    return out;
  }
  // истинная средняя скорость на интервале [a, b], об/мин
  function nTrueAvg(x, a, b) { var L = x.logs, s = 0, n = 0; for (var q = Math.max(0, Math.ceil(a / L.dec)); q <= Math.floor(b / L.dec) && q < L.iN; q++) { s += L.wS[q]; n++; } return n ? s / n * 30 / Math.PI : NaN; }
  function seriesIn(arr, a, b) { var o = []; for (var k = 0; k < arr.length; k += 2) if (arr[k] >= a && arr[k] <= b) o.push({ t: arr[k], v: arr[k + 1] }); return o; }
  // погрешность n_meas относительно средней истинной скорости за предшествующий период контура скорости
  function measErr(x, v, a, b) {
    var tr = seriesIn(x.logs.varT, a, b), T = v.tspd * HZ, mx = 0, sm = 0, n = 0, last = null;
    tr.forEach(function (p) { if (p.v === last) return; last = p.v; var e = p.v - nTrueAvg(x, p.t - T, p.t); if (!isFinite(e)) return; sm += e; n++; if (Math.abs(e) > Math.abs(mx)) mx = e; });
    return { mean: n ? sm / n : NaN, max: mx, n: n };
  }

  var LR4 = {
    id: 'lr4', no: 4,
    title: 'Контур скорости двигателя постоянного тока',
    variants: 30,
    variant: lr4V,
    interfaceVars: ['n_ref', 'n_meas', 'i_ref', 'i_meas'],
    sense: function (v) { return hallFor(v, 1); },
    trace: 'n_meas',
    demo: function (v) { var p = LR4.runs(v)[0].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), Tsim: p.Tsim, encoder: p.encoder, traceExtra: ['i_ref'] }; },
    describe: function (v) {
      return [
        ['Частота ШИМ f<sub>ШИМ</sub>, мертвое время', fmt(v.fsw / 1000, 1) + ' кГц, не менее ' + v.dtReq + ' нс (ЛР1)'],
        ['Вход nFAULT, вход АЦП, окно выборки', 'GPIO' + v.gpio + ', ADCINA' + v.ch + ', ' + v.tSmin + ' нс (ЛР1, ЛР2)'],
        ['Двигатель и датчик тока', 'по варианту ЛР3: U<sub>d</sub> = ' + v.vdc + ' В, I<sub>ном</sub> = ' + fmt(v.inom, 1) + ' А, R<sub>я</sub> = ' + fmt(v.R, 2) + ' Ом, L<sub>я</sub> = ' + fmt(v.L, 2) + ' мГн, ' + fmt(v.sens * 1000, 0) + ' мВ/А'],
        ['Коэффициент k<sub>Е</sub> = k<sub>М</sub>', fmt(v.ke, 3) + ' В·с/рад'],
        ['Номинальная частота вращения n<sub>ном</sub>', v.nnom + ' об/мин'],
        ['Суммарный момент инерции J<sub>Σ</sub>', String(v.jsum).replace('.', ',') + ' кг·м² (двигатель и нагрузка)'],
        ['Момент трения', fmt(v.tc, 3) + ' Н·м'],
        ['Наброс нагрузки ΔM<sub>с</sub>', fmt(v.mload, 3) + ' Н·м (0,5 M<sub>ном</sub>)'],
        ['Энкодер', v.lines + ' штрихов, каналы A, B на GPIO20, GPIO21, метка на GPIO23'],
        ['Период контура скорости', v.nspd + ' периодов ШИМ, ' + fmt(v.tspd * 1000, 2) + ' мс'],
        ['Ограничение задания тока I<sub>огр</sub>', fmt(v.ilim, 1) + ' А'],
        ['Низкая частота вращения n<sub>мин</sub>', v.nmin + ' об/мин'],
        ['Наименьший импульс нижнего ключа t<sub>bs</sub>, уставка защиты', fmt(v.tbs, 1) + ' мкс, ' + fmt(v.itrip, 1) + ' А'],
        ['Испытательные воздействия', 'начало при t<sub>1</sub> = ' + fmt(v.t1 * 1000, 0) + ' мс; малый скачок ' + v.n0 + ' → ' + (v.n0 + v.dn) + ' об/мин']
      ];
    },
    runs: function (v) {
      var mot = { ke: v.ke, km: v.ke, j: v.jsum, b: 0, tc: v.tc, tload: 0, locked: false };
      function base(seed, w0, extra) { return Object.assign({ plant: 'hbdc', Vdc: v.vdc, R: v.R, L: v.L, traceVar: 'n_meas', traceExtra: ['i_ref', 'i_meas'], seed: seed, sense: hallFor(v, seed), encoder: encFor(v, seed), motor: Object.assign({}, mot, { w0: w0 * Math.PI / 30 }) }, extra); }
      var t1 = v.t1, tC = v.tacc * 1.3 + 0.05, tD = 2 * v.tacc * v.nrev / v.nnom * 1.3 + 0.04;
      return [
        { id: 'A', title: 'малый скачок задания', params: base(11000 + v.n, v.n0, { Tsim: (t1 + 0.04) * 1e3, varEvents: [{ t: 0, name: 'n_ref', value: v.n0 }, { t: t1, name: 'n_ref', value: v.n0 + v.dn }] }) },
        { id: 'B', title: 'наброс нагрузки', params: base(12000 + v.n, v.nb, { Tsim: (t1 + 0.05) * 1e3, varEvents: [{ t: 0, name: 'n_ref', value: v.nb }], loadEvents: [{ t: t1, tload: v.mload }] }) },
        { id: 'C', title: 'разгон до номинальной частоты вращения', tEnd: t1 + tC, params: base(13000 + v.n, 0, { Tsim: (t1 + tC) * 1e3, varEvents: [{ t: t1, name: 'n_ref', value: v.nnom }] }) },
        { id: 'D', title: 'реверс', params: base(14000 + v.n, v.nrev, { Tsim: (t1 + tD) * 1e3, varEvents: [{ t: 0, name: 'n_ref', value: v.nrev }, { t: t1, name: 'n_ref', value: -v.nrev }] }) },
        { id: 'E', title: 'низкая частота вращения', params: base(15000 + v.n, 0, { Tsim: (t1 + 0.12) * 1e3, varEvents: [{ t: t1, name: 'n_ref', value: v.nmin }] }) }
      ];
    }
  };

  LR4.tests = [
    { id: 'И1', name: 'Силовая часть и контур тока', req: function (v) { return 'частота ШИМ ' + fmt(v.fsw / 1000, 3) + ' кГц ± 0,1 %, синхронные стойки, мертвое время ' + v.dtReq + '…' + (v.dtReq + 100) + ' нс, однополярная модуляция, запуск АЦП при TBCTR = TBPRD, один вызов обработчика за период, импульс нижнего ключа не короче ' + fmt(v.tbs, 1) + ' мкс, нет сквозного тока'; }, method: 'Требования ЛР1–ЛР3; режимы A–E.' },
    { id: 'И2', name: 'Подключение энкодера к eQEP1', req: function () { return 'счетчик положения принимает все импульсы энкодера, направление счета соответствует направлению вращения'; }, method: 'Режим C: число импульсов, принятых QPOSCNT, и знак измеренной частоты вращения.' },
    { id: 'И3', name: 'Период контура скорости', req: function (v) { return 'задание тока обновляется один раз за ' + v.nspd + ' периодов ШИМ (' + fmt(v.tspd * 1000, 2) + ' мс)'; }, method: 'Режим A: номера вызовов обработчика, в которых изменяется i_ref.' },
    { id: 'И4', name: 'Измерение частоты вращения при номинальной скорости', req: function (v) { return 'погрешность n_meas не более ' + fmt(lr4MeasNom(v), 2) + ' об/мин (0,1 % n<sub>ном</sub>)'; }, method: 'Режим C, последние 10 мс: разность n_meas и средней частоты вращения за период контура скорости.' },
    { id: 'И5', name: 'Измерение частоты вращения при низкой скорости', req: function (v) { return 'погрешность n_meas не более 5 % n<sub>мин</sub>, ' + fmt(0.05 * v.nmin, 2) + ' об/мин'; }, method: 'Режим E, последние 40 мс; при n<sub>мин</sub> за период контура скорости поступает два-три импульса энкодера (Z = 2N).' },
    { id: 'И6', name: 'Пульсации задания тока', req: function (v) { return 'размах i_ref при постоянной скорости не более 15 % I<sub>ном</sub>, ' + fmt(0.15 * v.inom, 2) + ' А'; }, method: 'Режим C, последние 10 мс.' },
    { id: 'И7', name: 'Переходная характеристика контура скорости', req: function (v) { return 'перерегулирование не более 15 %, время нарастания до 0,9 не более 9 T<sub>μω</sub> = ' + fmt(9 * v.tmuw * 1000, 1) + ' мс, задание тока не достигает ограничения, установившаяся ошибка не более 0,5 %'; }, method: 'Режим A: скачок ' + 'задания на Δn, частота вращения усреднена за период ШИМ.' },
    { id: 'И8', name: 'Наброс нагрузки', req: function (v) { return 'провал частоты вращения не более ' + fmt(1.6 * v.dropTh, 1) + ' об/мин, восстановление с точностью 1 % не позднее 25 T<sub>μω</sub> = ' + fmt(25 * v.tmuw * 1000, 0) + ' мс, установившаяся ошибка не более 0,5 %'; }, method: 'Режим B: момент ' + 'нагрузки 0,5 M<sub>ном</sub> при n = 0,5 n<sub>ном</sub>.' },
    { id: 'И9', name: 'Разгон с ограничением тока', req: function (v) { return 'ток якоря не более 1,05 I<sub>огр</sub> = ' + fmt(1.05 * v.ilim, 1) + ' А, время разгона до 0,9 n<sub>ном</sub> не более ' + fmt(lr4TAcc(v) * 1000, 0) + ' мс, перерегулирование не более 5 %'; }, method: 'Режим C: разгон от нуля до n<sub>ном</sub>.' },
    { id: 'И10', name: 'Компенсация ЭДС и включение на вращающийся двигатель', req: function (v) { return 'включение выходов при вращении без отключения защиты, с током не более I<sub>огр</sub> и снижением скорости не более 5 %; средняя ошибка регулирования тока (i_meas − i_ref) при разгоне не более 0,5 % I<sub>ном</sub>, ' + fmt(0.005 * v.inom * 1000, 0) + ' мА'; }, method: 'Режим B до наброса нагрузки; режим C при n от 0,2 до 0,8 n<sub>ном</sub>: без компенсации ЭДС интегральная составляющая регулятора тока отслеживает нарастающую ЭДС с ошибкой (de/dt)/K<sub>i</sub>.' },
    { id: 'И11', name: 'Реверс', req: function (v) { return 'переход от +' + v.nrev + ' к −' + v.nrev + ' об/мин без отключения защиты, перерегулирование не более 5 %, установившаяся ошибка и погрешность измерения не более 0,5 % n<sub>ном</sub>'; }, method: 'Режим D.' },
    { id: 'И12', name: 'Работа на низкой скорости', req: function (v) { return 'средняя частота вращения ' + v.nmin + ' об/мин ± 2 %, отклонения не более ±10 %'; }, method: 'Режим E, последние 40 мс; частота вращения усреднена за период ШИМ.' },
    { id: 'И13', name: 'Включение выходов и защита', req: function (v) { return 'выходы обеих стоек отключены при калибровке и включены до t = ' + fmt((v.t1 - 0.02) * 1000, 0) + ' мс, нет отключений защиты'; }, method: 'Режимы A–E.' },
    { id: 'И14', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные n_ref, n_meas, i_ref, i_meas, отсутствие ошибок выполнения.' }
  ];
  function lr4MeasNom(v) { return 0.001 * v.nnom; }
  function lr4TAcc(v) { return 1.1 * 0.9 * v.tacc + 10 * v.tmuw; }
  LR4.evaluate = function (v, R) {
    var A = R.A, B = R.B, Cc = R.C, D = R.D, E = R.E, out = {}, all = [A, B, Cc, D, E];
    function res(ok, meas) { return { ok: ok, meas: meas }; }
    function bad(meas) { return { ok: false, meas: meas }; }
    function live(x) { return x && !x.compileError; }
    if (!live(A)) { LR4.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + (A ? A.compileError : 'нет результата')); }); return out; }
    var T = HZ / v.fsw, t1 = Math.round(v.t1 * HZ), m = A.measures;
    function nearest(arr, t) { var lo = 0, hi = arr.length - 1, best = Infinity; while (lo <= hi) { var mid = (lo + hi) >> 1; var d = t - arr[mid]; if (Math.abs(d) < Math.abs(best)) best = d; if (arr[mid] < t) lo = mid + 1; else hi = mid - 1; } return best === Infinity ? 1e9 : best; }
    function tripsOf(x) { var en = enableTick(x); return en === null ? [] : trips(x, Math.max(en, 10)); }
    function avgIn(av, a, b) { var s = 0, n = 0; av.forEach(function (p) { if (p.t >= a && p.t <= b) { s += p.n; n++; } }); return n ? s / n : NaN; }
    var AV = {}; all.forEach(function (x, i) { if (live(x)) AV['ABCDE'[i]] = nAvgPeriods(x); });
    var TR = {}; all.forEach(function (x, i) { if (live(x)) TR['ABCDE'[i]] = tripsOf(x); });
    function tripTxt(k) { var tr = TR[k]; return tr && tr.length ? 'отключение защиты при t = ' + fmt(tr[0].t / HZ * 1000, 2) + ' мс' : null; }
    // И1
    var p1 = [];
    if (!m.fpwm) p1.push('счетчик ePWM1 не работает');
    else { var e1 = (m.fpwm - v.fsw) / v.fsw * 100; if (Math.abs(e1) > 0.1) p1.push('частота ШИМ ' + fmt(m.fpwm / 1000, 3) + ' кГц'); }
    var z2 = A.logs.zeroT2; if (z2.length < 3) p1.push('счетчик ePWM2 не работает'); else { var w1 = 0; z2.slice(-100).forEach(function (t) { var d = nearest(A.logs.zeroT, t); if (Math.abs(d) > Math.abs(w1)) w1 = d; }); if (Math.abs(w1) > 1) p1.push('счетчики стоек не синхронны'); }
    [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; if (mn < v.dtReq - 0.5 || mx > v.dtReq + 100.5) p1.push('мертвое время стойки ' + d[0] + ' ' + Math.round(mn) + '…' + Math.round(mx) + ' нс'); });
    var shN = 0; all.forEach(function (x) { if (live(x)) shN += x.measures.shootN; }); if (shN) p1.push('сквозной ток');
    var enA = enableTick(A);
    if (live(Cc) && enableTick(Cc) !== null) { var fr = vmFractions(Cc, t1 + 0.2 * v.tacc * HZ, t1 + 0.6 * v.tacc * HZ, v.vdc); if (fr.neg > 4 * v.dt * v.fsw + 0.01) p1.push('двухполярная модуляция'); }
    var tp = adcTuples(A).filter(function (q) { return enA !== null && q.t0 > enA + T; });
    if (!tp.length) p1.push('АЦП не запускается'); else { var wst = 0; tp.forEach(function (q) { var dp = nearest(A.logs.prdT, q.t0); if (Math.abs(dp) > Math.abs(wst)) wst = dp; }); if (Math.abs(wst) > 5) p1.push('запуск АЦП не при TBCTR = TBPRD'); }
    var it = A.logs.isrT; if (A.isrBy.adc < 3) p1.push('обработчик АЦП не вызывается'); else { var fi = (it.length - 1) / ((it[it.length - 1] - it[0]) / HZ); if (Math.abs(fi - v.fsw) / v.fsw > 0.001) p1.push('частота вызова обработчика ' + fmt(fi / 1000, 3) + ' кГц'); }
    var minLow = Infinity, miss = 0;
    all.forEach(function (x) {
      if (!live(x)) return; var en = enableTick(x); if (en === null) return;
      var tr = trips(x, Math.max(en, 10)), to = tr.length ? tr[0].t : x.endTick, z = x.logs.zeroT;
      [0, 1].forEach(function (mi) { var ed = x.logs.ed[mi]; if (!ed) return; var hi = edgesHigh(ed.B, en + T, to - T), k = 0;
        for (var p = 0; p + 1 < z.length; p++) { if (z[p] < en + 2 * T || z[p + 1] > to - T) continue; var w = 0; while (k < hi.length && hi[k].b <= z[p]) k++; for (var q = k; q < hi.length && hi[q].a < z[p + 1]; q++) w = Math.max(w, Math.min(hi[q].b, z[p + 1]) - Math.max(hi[q].a, z[p])); if (w < minLow) minLow = w; if (w < v.tbs * 100 - 0.5) miss++; } });
    });
    if (miss) p1.push(miss + ' периодов с импульсом нижнего ключа короче t_bs');
    out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : 'требования ЛР1–ЛР3 выполнены, наименьший импульс нижнего ключа ' + fmt(minLow / 100, 2) + ' мкс');
    // И2
    if (!live(Cc) || !Cc.qep) out['И2'] = bad('нет данных');
    else {
      var q = Cc.qep, w2 = [];
      ['qepmux', 'qepen', 'qsrc', 'qposmax'].forEach(function (k) { if (Cc.warnKeys.indexOf(k) >= 0) w2.push({ qepmux: 'выводы GPIO20, GPIO21 не подключены к eQEP1', qepen: 'QPEN = 0', qsrc: 'режим счета не квадратурный', qposmax: 'QPOSMAX = 0' }[k]); });
      var mult = q.counted / Math.max(1, q.edges) * 4;
      if (Math.abs(mult - 4) > 0.1 && Math.abs(mult - 2) > 0.05) w2.push('принято ' + q.counted + ' импульсов при ' + q.edges + ' фронтах каналов A и B');
      var nEnd = avgIn(AV.C, Cc.endTick - 0.01 * HZ, Cc.endTick), mEnd = seriesIn(Cc.logs.varT, Cc.endTick - 0.01 * HZ, Cc.endTick);
      var nm2 = mEnd.length ? mEnd[mEnd.length - 1].v : NaN;
      if (!(nm2 > 0)) w2.push('измеренная частота вращения ' + (isFinite(nm2) ? fmt(nm2, 1) : 'не вычисляется') + ' при вращении в положительном направлении');
      out['И2'] = res(w2.length === 0, w2.length ? w2.join('; ') : 'принято ' + q.counted + ' импульсов (' + (Math.abs(mult - 2) < 0.05 ? 'фронты канала A, два' : 'фронты каналов A и B, четыре') + ' на штрих), направление верное');
    }
    // И3
    var irA = A.logs.varX.i_ref, isr = A.logs.isrT, chg = [], idx = 0, prev = null;
    for (var k = 0; k < irA.length; k += 2) { var val = irA[k + 1]; if (prev !== null && val !== prev && irA[k] > (enA || 0)) chg.push(k / 2); prev = val; }
    if (chg.length < 5) out['И3'] = bad('задание тока не изменяется');
    else {
      var badStep = 0; for (var c = 1; c < chg.length; c++) if ((chg[c] - chg[0]) % v.nspd !== 0) badStep++;
      var minGap = Infinity; for (c = 1; c < chg.length; c++) minGap = Math.min(minGap, chg[c] - chg[c - 1]);
      out['И3'] = res(badStep === 0 && minGap >= v.nspd, badStep ? 'задание тока изменяется не кратно ' + v.nspd + ' вызовам обработчика, наименьший интервал ' + minGap + ' вызовов' : 'обновление каждые ' + minGap + ' периодов ШИМ и реже');
    }
    // И4, И6
    if (!live(Cc)) { out['И4'] = bad('нет данных'); out['И6'] = bad('нет данных'); }
    else if (tripTxt('C')) { out['И4'] = bad(tripTxt('C')); out['И6'] = bad(tripTxt('C')); }
    else {
      var me4 = measErr(Cc, v, Cc.endTick - 0.01 * HZ, Cc.endTick);
      out['И4'] = !me4.n ? bad('n_meas не изменяется') : res(Math.abs(me4.max) <= lr4MeasNom(v), 'наибольшая ' + fmt(me4.max, 2) + ' об/мин, средняя ' + fmt(me4.mean, 2) + ' об/мин при ' + fmt(avgIn(AV.C, Cc.endTick - 0.01 * HZ, Cc.endTick), 0) + ' об/мин');
      var ip = seriesIn(Cc.logs.varX.i_ref, Cc.endTick - 0.01 * HZ, Cc.endTick).map(function (p) { return p.v; });
      var pp = ip.length ? Math.max.apply(null, ip) - Math.min.apply(null, ip) : NaN;
      out['И6'] = res(pp <= 0.15 * v.inom, 'размах ' + fmt(pp, 2) + ' А (' + fmt(pp / v.inom * 100, 1) + ' % I<sub>ном</sub>)');
      out['И6'].meas = out['И6'].meas.replace('<sub>ном</sub>', 'ном');
    }
    // И5, И12
    if (!live(E)) { out['И5'] = bad('нет данных'); out['И12'] = bad('нет данных'); }
    else if (tripTxt('E')) { out['И5'] = bad(tripTxt('E')); out['И12'] = bad(tripTxt('E')); }
    else {
      var me5 = measErr(E, v, E.endTick - 0.04 * HZ, E.endTick);
      out['И5'] = !me5.n ? bad('n_meas не изменяется') : res(Math.abs(me5.max) <= 0.05 * v.nmin, 'наибольшая ' + fmt(me5.max, 2) + ' об/мин (' + fmt(Math.abs(me5.max) / v.nmin * 100, 1) + ' %)');
      var aE = AV.E.filter(function (p) { return p.t > E.endTick - 0.04 * HZ; }).map(function (p) { return p.n; });
      var mE = aE.reduce(function (s, x) { return s + x; }, 0) / aE.length, dE = Math.max(Math.max.apply(null, aE) - v.nmin, v.nmin - Math.min.apply(null, aE));
      out['И12'] = res(Math.abs(mE - v.nmin) <= 0.02 * v.nmin && dE <= 0.1 * v.nmin, 'средняя ' + fmt(mE, 2) + ' об/мин, отклонения до ' + fmt(dE, 2) + ' об/мин');
    }
    // И7
    if (tripTxt('A')) out['И7'] = bad(tripTxt('A'));
    else {
      var aA = AV.A.filter(function (p) { return p.t > t1; }), nmx = -Infinity, t90 = null, tgt = v.n0 + v.dn;
      aA.forEach(function (p) { if (p.n > nmx) nmx = p.n; if (t90 === null && p.n >= v.n0 + 0.9 * v.dn) t90 = (p.t - t1) / HZ; });
      var fin7 = avgIn(AV.A, A.endTick - 0.005 * HZ, A.endTick), ov7 = (nmx - v.n0) / v.dn * 100 - 100;
      var ir7 = seriesIn(A.logs.varX.i_ref, t1, A.endTick).map(function (p) { return Math.abs(p.v); }), im7 = ir7.length ? Math.max.apply(null, ir7) : 0;
      var ok7 = ov7 <= 15 && t90 !== null && t90 <= 9 * v.tmuw && im7 < 0.98 * v.ilim && Math.abs(fin7 - tgt) <= 0.005 * tgt;
      out['И7'] = res(ok7, 'перерегулирование ' + fmt(ov7, 1) + ' %, время нарастания ' + (t90 === null ? 'не достигнуто' : fmt(t90 * 1000, 2) + ' мс (' + fmt(t90 / v.tmuw, 1) + ' T_μω)') + ', наибольшее задание тока ' + fmt(im7, 2) + ' А, ошибка ' + fmt(fin7 - tgt, 2) + ' об/мин');
    }
    // И8
    if (!live(B)) out['И8'] = bad('нет данных');
    else if (tripTxt('B')) out['И8'] = bad(tripTxt('B'));
    else {
      var aB = AV.B.filter(function (p) { return p.t > t1; }), nmn = Infinity, trec = 0;
      aB.forEach(function (p) { if (p.n < nmn) nmn = p.n; });
      for (var kb = aB.length - 1; kb >= 0; kb--) if (Math.abs(aB[kb].n - v.nb) > 0.01 * v.nb) { trec = (aB[kb].t - t1) / HZ; break; }
      var fin8 = avgIn(AV.B, B.endTick - 0.005 * HZ, B.endTick), drop = v.nb - nmn;
      out['И8'] = res(drop <= 1.6 * v.dropTh && trec <= 25 * v.tmuw && Math.abs(fin8 - v.nb) <= 0.005 * v.nb, 'провал ' + fmt(drop, 1) + ' об/мин, восстановление ' + fmt(trec * 1000, 1) + ' мс, ошибка ' + fmt(fin8 - v.nb, 2) + ' об/мин');
    }
    // И9
    if (!live(Cc)) out['И9'] = bad('нет данных');
    else if (tripTxt('C')) out['И9'] = bad(tripTxt('C'));
    else {
      var aC = AV.C.filter(function (p) { return p.t > t1; }), imC = 0, nmC = -Infinity, t9 = null;
      aC.forEach(function (p) { imC = Math.max(imC, Math.abs(p.i)); if (p.n > nmC) nmC = p.n; if (t9 === null && p.n >= 0.9 * v.nnom) t9 = (p.t - t1) / HZ; });
      var ov9 = (nmC / v.nnom - 1) * 100;
      out['И9'] = res(imC <= 1.05 * v.ilim && t9 !== null && t9 <= lr4TAcc(v) && ov9 <= 5, 'ток до ' + fmt(imC, 2) + ' А, разгон ' + (t9 === null ? 'не завершен' : fmt(t9 * 1000, 1) + ' мс') + ', перерегулирование ' + fmt(ov9, 1) + ' %');
    }
    // И10
    var p10 = [];
    if (!live(B)) p10.push('B: нет данных');
    else {
      var enB = enableTick(B);
      if (enB === null) p10.push('B: выходы не включены');
      else {
        var trB = TR.B.filter(function (x) { return x.t < t1; }); if (trB.length) p10.push('B: отключение защиты при включении на вращающийся двигатель');
        var aB0 = AV.B.filter(function (p) { return p.t > enB && p.t < t1; }), imB = 0; aB0.forEach(function (p) { imB = Math.max(imB, Math.abs(p.i)); });
        if (imB > v.ilim) p10.push('B: ток при включении ' + fmt(imB, 1) + ' А');
        var nEn = null, e10b = 0; aB0.forEach(function (p) { if (nEn === null) nEn = p.n; e10b = Math.max(e10b, nEn - p.n); });
        if (e10b > 0.05 * v.nb) p10.push('B: снижение скорости после включения ' + fmt(e10b, 1) + ' об/мин');
      }
    }
    var e10 = NaN;
    if (live(Cc) && !tripTxt('C') && Cc.logs.varX.i_meas) {
      var irs = Cc.logs.varX.i_ref, ims = Cc.logs.varX.i_meas, s10 = 0, c10 = 0;
      for (var k10 = 0; k10 < irs.length; k10 += 2) { var tt10 = irs[k10]; if (tt10 < t1 + 0.2 * v.tacc * HZ || tt10 > t1 + 0.6 * v.tacc * HZ) continue; if (isFinite(ims[k10 + 1]) && isFinite(irs[k10 + 1])) { s10 += ims[k10 + 1] - irs[k10 + 1]; c10++; } }
      e10 = c10 ? s10 / c10 : NaN;
      if (!isFinite(e10)) p10.push('C: нет переменных i_ref, i_meas');
      else if (Math.abs(e10) > 0.005 * v.inom) p10.push('C: средняя ошибка тока при разгоне ' + fmt(e10 * 1000, 0) + ' мА (' + fmt(e10 / v.inom * 100, 2) + ' % Iном)');
    } else p10.push('C: нет данных');
    out['И10'] = res(p10.length === 0, p10.length ? p10.join('; ') : 'включение без броска тока, средняя ошибка тока при разгоне ' + fmt(e10 * 1000, 1) + ' мА');
    // И11
    if (!live(D)) out['И11'] = bad('нет данных');
    else if (tripTxt('D')) out['И11'] = bad(tripTxt('D'));
    else {
      var aD = AV.D.filter(function (p) { return p.t > t1; }), nmD = Infinity; aD.forEach(function (p) { if (p.n < nmD) nmD = p.n; });
      var ovD = (-nmD / v.nrev - 1) * 100, finD = avgIn(AV.D, D.endTick - 0.01 * HZ, D.endTick), meD = measErr(D, v, D.endTick - 0.01 * HZ, D.endTick);
      var okD = ovD <= 5 && Math.abs(finD + v.nrev) <= 0.005 * v.nnom && meD.n > 0 && Math.abs(meD.max) <= 0.005 * v.nnom;
      out['И11'] = res(okD, 'перерегулирование ' + fmt(ovD, 1) + ' %, ошибка ' + fmt(finD + v.nrev, 2) + ' об/мин, погрешность измерения до ' + fmt(meD.max, 2) + ' об/мин');
    }
    // И13
    var p13 = [];
    all.forEach(function (x, i) {
      var nm = 'ABCDE'[i]; if (!live(x)) return; var en = enableTick(x);
      if (en === null) { p13.push(nm + ': выходы не включены'); return; }
      if (en === 0) p13.push(nm + ': выходы не отключены на время калибровки');
      else if (en > t1 - 0.02 * HZ) p13.push(nm + ': выходы включены через ' + fmt(en / HZ * 1e3, 1) + ' мс');
      if (en > 0 && x.logs.ed[1] && (edgesHigh(x.logs.ed[1].A, 10, en - 10).length || edgesHigh(x.logs.ed[1].B, 10, en - 10).length)) p13.push(nm + ': стойка B не отключена при калибровке');
      if (TR[nm] && TR[nm].length) p13.push(nm + ': отключение при t = ' + fmt(TR[nm][0].t / HZ * 1e3, 2) + ' мс');
    });
    out['И13'] = res(p13.length === 0, p13.length ? p13.join('; ') : 'выходы включены через ' + fmt((enA || 0) / HZ * 1e3, 1) + ' мс, отключений нет');
    // И14
    var viol = [];
    all.forEach(function (x) {
      if (!live(x)) return;
      if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
      if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
      if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
      if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
      if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
      if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
      ['n_meas', 'i_ref', 'i_meas'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
      if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
      if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
    });
    viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
    out['И14'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
    return out;
  };

  /* ------------------------------------------------------------ */
  /* ЛР5. Частотное управление асинхронным двигателем насоса      */
  /* ------------------------------------------------------------ */
  var IMS = [
    { pn: 0.55, rs: 12.0, rr: 17.7, ll: 0.040, lm: 0.75, jm: 0.0012, nn: 1360 },
    { pn: 0.75, rs: 9.5, rr: 11.9, ll: 0.035, lm: 0.62, jm: 0.0016, nn: 1370 },
    { pn: 1.1, rs: 6.5, rr: 6.3, ll: 0.028, lm: 0.48, jm: 0.0021, nn: 1400 },
    { pn: 1.5, rs: 4.8, rr: 4.2, ll: 0.022, lm: 0.40, jm: 0.0035, nn: 1410 },
    { pn: 2.2, rs: 3.0, rr: 2.6, ll: 0.016, lm: 0.30, jm: 0.0055, nn: 1420 }
  ];
  // установившийся режим по Т-образной схеме замещения: ток статора, момент
  function imSteady(m, U, f, s) {
    var w = 2 * Math.PI * f;
    function c(re, im) { return { re: re, im: im }; }
    function add(a, b) { return c(a.re + b.re, a.im + b.im); }
    function mul(a, b) { return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
    function div(a, b) { var d = b.re * b.re + b.im * b.im; return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); }
    function abs(a) { return Math.hypot(a.re, a.im); }
    var Zr = c(m.rr / s, w * m.ll), Zm = c(0, w * m.lm), Zp = div(mul(Zr, Zm), add(Zr, Zm)), Z = add(c(m.rs, w * m.ll), Zp);
    var I = div(c(U, 0), Z), Ir = div(mul(I, Zm), add(Zr, Zm));
    var T = 3 * Math.pow(abs(Ir), 2) * m.rr / s / (w / 2);
    return { I: abs(I), T: T, cos: I.re / abs(I) };
  }
  function lr5Variant(n) {
    var v = { n: n }, r = rng(49979687 * n + 11);
    var b = lr1Variant(n);
    v.gpio = b.gpio;
    v.fsw = [5000, 8000, 10000][(n - 1) % 3];
    v.tbprd = Math.round(HZ / (2 * v.fsw));
    v.vdc = pick(r, [560, 570, 580]);
    v.mi = (n * 3 + 1) % IMS.length; var m = IMS[v.mi];
    v.m = m;
    v.dtReq = 100 * Math.round(20 + 10 * r());                     // нс, 2,0..3,0 мкс
    v.dbTicks = v.dtReq / 10;
    v.ch = 2 + Math.floor(r() * 3); v.chb = v.ch + 1;
    v.tSmin = 5 * Math.round((75 + 225 * r()) / 5);
    v.acqps = Math.ceil(v.tSmin / 5 - 1e-9) - 1;
    v.un = 220; v.fn = 50; v.unm = Math.sqrt(2) * v.un;
    var sn = (1500 - m.nn) / 1500, st = imSteady(m, v.un, v.fn, sn);
    v.inom = Math.round(st.I * 100) / 100; v.tn = st.T; v.cosn = st.cos; v.sn = sn;
    v.i0 = v.un / (2 * Math.PI * v.fn * (m.ll + m.lm));
    v.kj = stepIn(r, 0.3, 1.0, 0.1);
    v.jsum = sig2(m.jm * (1 + v.kj));
    v.tc = Math.round(0.02 * v.tn * 1000) / 1000;
    v.mpn = v.tn - v.tc;                                              // момент насоса при номинальной скорости
    v.wn = m.nn * Math.PI / 30;
    v.tramp = +Math.min(0.4, Math.max(0.15, Math.ceil(v.jsum * 50 * Math.PI / (0.5 * v.tn) / 0.05) * 0.05)).toFixed(2);
    v.flow = pick(r, [10, 12.5]);
    v.dU = 4 / Math.PI * v.vdc * v.dtReq * 1e-9 * v.fsw;              // амплитуда первой гармоники ошибки мертвого времени
    v.u0 = Math.round(0.02 * v.unm);                                  // начальное напряжение закона U/f, 2 % Uном
    v.ulow = v.u0 + (v.unm - v.u0) * v.flow / v.fn;
    v.imax = r1(2.2 * Math.sqrt(2) * v.inom);
    v.sens = HALL_S[HALL_S.length - 1];
    for (var q = 0; q < HALL_S.length; q++) if (1.65 / HALL_S[q] >= 1.3 * v.imax) { v.sens = HALL_S[q]; break; }
    v.ifs = 1.65 / v.sens;
    v.pol = r() < 0.5 ? 1 : -1;
    v.bw = pick(r, [80, 120]);
    v.tcal = 256 / v.fsw;
    v.t1 = Math.ceil((v.tcal + 0.005) * 1000) / 1000;
    return v;
  }
  function im5For(v, seed) {
    var r = rng(seed * 41 + 3), ch = [];
    [[v.ch, 0], [v.chb, 1]].forEach(function (c) { ch.push({ ch: c[0], ph: c[1], sens: v.sens, pol: v.pol, voff: (0.010 + 0.015 * r()) * (r() < 0.5 ? -1 : 1), gerr: (r() * 2 - 1) * 0.008 }); });
    return { type: 'hall2', chans: ch, ch: v.ch, sens: v.sens, pol: v.pol, voff: 0, gerr: 0, tauAmp: 1 / (2 * Math.PI * v.bw * 1e3), tauS: v.tSmin * 1e-9 / Math.log(8192) };
  }
  function im5Motor(v) { var m = v.m; return { rs: m.rs, rr: m.rr, lls: m.ll, llr: m.ll, lm: m.lm, p: 2, j: v.jsum, mpn: v.mpn, wn: v.wn, tc: v.tc, tload: 0, locked: false }; }

  function lr5Window(v) { var ts = v.t1 + v.tramp + 0.12; return { a: ts, b: ts + 2 / v.fn, tj: ts + 2 / v.fn, end: ts + 2 / v.fn + 0.03 }; }
  function lr5WindowB(v) { var a = v.t1 + v.tramp * v.flow / v.fn + 0.06; return { a: a, b: a + 1 / v.flow }; }
  // комплексная амплитуда первой гармоники дискретного сигнала buf на [a, b] при частоте f
  function phasor(buf, dec, a, b, f) {
    var w = 2 * Math.PI * f / HZ, re = 0, im = 0, n = 0;
    for (var k = Math.ceil(a / dec); k < Math.floor(b / dec); k++) { var t = (k + 1) * dec; re += buf[k] * Math.cos(w * t); im -= buf[k] * Math.sin(w * t); n++; }
    return { re: 2 * re / n, im: 2 * im / n };
  }
  function phasorStep(ed, endTick, a, b, f) {
    var w = 2 * Math.PI * f / HZ, re = 0, im = 0;
    for (var k = 0; k < ed.length; k += 2) {
      var x0 = Math.max(ed[k], a), x1 = Math.min(k + 2 < ed.length ? ed[k + 2] : endTick, b);
      if (x1 <= x0) continue;
      var val = ed[k + 1];
      re += val * (Math.sin(w * x1) - Math.sin(w * x0)) / w; im += val * (Math.cos(w * x1) - Math.cos(w * x0)) / w;
    }
    var T = b - a; return { re: 2 * re / T, im: 2 * im / T };
  }
  function ang(z) { return Math.atan2(z.im, z.re); }
  function mag(z) { return Math.hypot(z.re, z.im); }

  var LR5 = {
    id: 'lr5', no: 5,
    title: 'Частотное управление асинхронным двигателем насоса',
    variants: 30,
    variant: lr5Variant,
    interfaceVars: ['f_ref', 'f_out', 'i_a', 'i_b'],
    sense: function (v) { return im5For(v, 1); },
    trace: 'f_out',
    demo: function (v) { var p = LR5.runs(v)[1].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), Tsim: p.Tsim, traceExtra: ['i_a', 'i_b'] }; },
    describe: function (v) {
      var m = v.m;
      return [
        ['Напряжение звена U<sub>d</sub>', v.vdc + ' В (выпрямленное напряжение сети 380–400 В)'],
        ['Частота ШИМ, мертвое время', fmt(v.fsw / 1000, 0) + ' кГц, не менее ' + fmt(v.dtReq / 1000, 1) + ' мкс (IGBT)'],
        ['Вход nFAULT', 'GPIO' + v.gpio],
        ['Двигатель', 'асинхронный, ' + fmt(m.pn, 2) + ' кВт, 380 В (звезда), 50 Гц, 2p = 4, n<sub>ном</sub> = ' + m.nn + ' об/мин, I<sub>ном</sub> = ' + fmt(v.inom, 2) + ' А'],
        ['Параметры схемы замещения', 'R<sub>s</sub> = ' + fmt(m.rs, 1) + ' Ом, R<sub>r</sub>′ = ' + fmt(m.rr, 1) + ' Ом, L<sub>σs</sub> = L<sub>σr</sub>′ = ' + fmt(m.ll * 1000, 0) + ' мГн, L<sub>m</sub> = ' + fmt(m.lm, 2) + ' Гн'],
        ['Нагрузка', 'центробежный насос, M<sub>c</sub> ∝ n²; J<sub>Σ</sub> = ' + String(v.jsum).replace('.', ',') + ' кг·м²'],
        ['Датчики тока фаз A и B', 'Холла, ' + fmt(v.sens * 1000, 0) + ' мВ/А, ADCINA' + v.ch + ' и ADCINA' + v.chb + ', ' + (v.pol > 0 ? 'напряжение растет при токе в двигатель' : 'напряжение убывает при токе в двигатель') + ', окно выборки не менее ' + v.tSmin + ' нс'],
        ['Закон U/f', 'U<sub>0</sub> = ' + v.u0 + ' В при f → 0, U<sub>ном</sub> = 220 В (амплитуда ' + fmt(v.unm, 1) + ' В) при 50 Гц'],
        ['Время разгона до 50 Гц', fmt(v.tramp, 2) + ' с (в модели сокращено)'],
        ['Низкая частота испытаний f<sub>н</sub>', fmt(v.flow, 1) + ' Гц'],
        ['Уставка защиты по амплитуде тока I<sub>max</sub>', fmt(v.imax, 1) + ' А'],
        ['Начало испытательных воздействий t<sub>1</sub>', fmt(v.t1 * 1000, 0) + ' мс']
      ];
    },
    runs: function (v) {
      function base(seed, extra) { return Object.assign({ plant: 'im3', Vdc: v.vdc, R: 1, L: 1, traceVar: 'f_out', traceExtra: ['i_a', 'i_b'], seed: seed, sense: im5For(v, seed), motor: im5Motor(v) }, extra); }
      var W = lr5Window(v), WB = lr5WindowB(v);
      return [
        { id: 'A', title: 'пуск, номинальный режим, заклинивание', params: base(21000 + v.n, { Tsim: W.end * 1e3, varEvents: [{ t: v.t1, name: 'f_ref', value: v.fn }], loadEvents: [{ t: W.tj, locked: true }] }) },
        { id: 'B', title: 'работа на низкой частоте', params: base(22000 + v.n, { Tsim: WB.b * 1e3 + 1, varEvents: [{ t: v.t1, name: 'f_ref', value: v.flow }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'ШИМ трех стоек', req: function (v) { return 'частота ' + fmt(v.fsw / 1000, 0) + ' кГц ± 0,1 %, счетчики синхронны, мертвое время ' + fmt(v.dtReq / 1000, 1) + '…' + fmt((v.dtReq + 200) / 1000, 1) + ' мкс в каждой стойке, нет сквозного тока'; }, method: 'Режимы A и B.' },
      { id: 'И2', name: 'Измерение токов фаз', req: function (v) { return 'запуск АЦП при TBCTR = TBPRD, входы ADCINA' + v.ch + ' и ADCINA' + v.chb + ', окно не менее ' + v.tSmin + ' нс; погрешность i_a, i_b: систематическая не более 0,5 %, наибольшая не более 2 % диапазона ' + fmt(v.ifs, 1) + ' А'; }, method: 'Режим A до заклинивания.' },
      { id: 'И3', name: 'Частота и порядок фаз', req: function (v) { return 'частота ' + v.fn + ' Гц ± 0,4 %, ток фазы B отстает от тока фазы A на 120° ± 5°, ротор вращается в положительном направлении'; }, method: 'Режим A, установившийся режим, два периода.' },
      { id: 'И4', name: 'Напряжение при номинальной частоте', req: function (v) { return 'амплитуда первой гармоники фазного напряжения ' + fmt(v.unm, 1) + ' В ± 3 %, 3-я гармоника коэффициента заполнения стойки A не менее 10 % первой (добавка нулевой последовательности)'; }, method: 'Режим A, два периода при 50 Гц; синусоидальная ШИМ в линейном режиме дает не более U<sub>d</sub>/2.' },
      { id: 'И5', name: 'Напряжение при низкой частоте', req: function (v) { return 'амплитуда первой гармоники ' + fmt(v.ulow, 1) + ' В ± 5 % по закону U/f'; }, method: 'Режим B, период при f<sub>н</sub>; без компенсации мертвого времени напряжение ниже заданного.' },
      { id: 'И6', name: 'Разгон', req: function (v) { return 'темп нарастания частоты ' + fmt(v.fn / v.tramp, 0) + ' Гц/с ± 5 %, амплитуда тока фаз не превышает уставку защиты ' + fmt(v.imax, 1) + ' А'; }, method: 'Режим A: f_out от 10 до 90 % номинальной частоты.' },
      { id: 'И7', name: 'Номинальный режим', req: function (v) { return 'частота вращения ' + v.m.nn + ' об/мин ± ' + fmt(0.3 * (1500 - v.m.nn), 0) + ' об/мин, амплитуда тока не более ' + fmt(1.1 * Math.SQRT2 * v.inom, 2) + ' А'; }, method: 'Режим A, установившийся режим при 50 Гц.' },
      { id: 'И8', name: 'Защита при заклинивании насоса', req: function (v) { return 'все шесть ключей закрыты не позднее двух периодов ШИМ после превышения амплитуды тока ' + fmt(v.imax, 1) + ' А и остаются закрытыми'; }, method: 'Режим A: ротор заторможен в установившемся режиме при 50 Гц.' },
      { id: 'И9', name: 'Включение выходов', req: function (v) { return 'выходы трех стоек отключены при калибровке, включены до t = ' + fmt(v.t1 * 1000, 0) + ' мс, ложных отключений нет'; }, method: 'Режимы A и B.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные f_ref, f_out, i_a, i_b, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, B = R.B, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      function live(x) { return x && !x.compileError; }
      if (!live(A)) { LR5.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + (A ? A.compileError : 'нет результата')); }); return out; }
      var T = HZ / v.fsw, t1 = Math.round(v.t1 * HZ), W = lr5Window(v), WB = lr5WindowB(v), m = A.measures;
      var wa = Math.round(W.a * HZ), wb = Math.round(W.b * HZ), tj = Math.round(W.tj * HZ);
      function nearest(arr, t) { var lo = 0, hi = arr.length - 1, best = Infinity; while (lo <= hi) { var mid = (lo + hi) >> 1; var d = t - arr[mid]; if (Math.abs(d) < Math.abs(best)) best = d; if (arr[mid] < t) lo = mid + 1; else hi = mid - 1; } return best === Infinity ? 1e9 : best; }
      var enA = enableTick(A), trA = enA === null ? [] : trips(A, Math.max(enA, 10)), trBefore = trA.filter(function (q) { return q.t < tj; });
      // И1
      var p1 = [];
      if (!m.fpwm) p1.push('счетчик ePWM1 не работает'); else if (Math.abs(m.fpwm - v.fsw) / v.fsw > 0.001) p1.push('частота ' + fmt(m.fpwm / 1000, 3) + ' кГц');
      [['ePWM2', A.logs.zeroT2], ['ePWM3', A.logs.zeroT3]].forEach(function (z) { if (z[1].length < 3) { p1.push('счетчик ' + z[0] + ' не работает'); return; } var w1 = 0; z[1].slice(-100).forEach(function (t) { var d = nearest(A.logs.zeroT, t); if (Math.abs(d) > Math.abs(w1)) w1 = d; }); if (Math.abs(w1) > 1) p1.push('счетчик ' + z[0] + ' не синхронен с ePWM1'); });
      var dmn = Infinity, dmx = 0;
      [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA], ['C', m.dt3AB, m.dt3BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; dmn = Math.min(dmn, mn); dmx = Math.max(dmx, mx); if (mn < v.dtReq - 0.5 || mx > v.dtReq + 200.5) p1.push('мертвое время стойки ' + d[0] + ' ' + fmt(mn / 1000, 2) + '…' + fmt(mx / 1000, 2) + ' мкс'); });
      var shN = 0; [A, B].forEach(function (x) { if (live(x)) shN += x.measures.shootN; }); if (shN) p1.push('сквозной ток');
      out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : fmt(m.fpwm / 1000, 3) + ' кГц, мертвое время ' + fmt(dmn / 1000, 2) + '…' + fmt(dmx / 1000, 2) + ' мкс');
      // И2
      var p2 = [], tp = adcTuples(A).filter(function (q) { return enA !== null && q.t0 > enA + T && q.t0 < tj; });
      if (!tp.length) p2.push('АЦП не запускается');
      else {
        var wst = 0; tp.forEach(function (q) { if (q.soc !== 0) return; var dp = nearest(A.logs.prdT, q.t0); if (Math.abs(dp) > Math.abs(wst)) wst = dp; }); if (Math.abs(wst) > 5) p2.push('запуск АЦП не при TBCTR = TBPRD');
        [v.ch, v.chb].forEach(function (ch) { var c = tp.filter(function (q) { return q.ch === ch; }); if (!c.length) p2.push('ADCINA' + ch + ' не оцифровывается'); else if (Math.min.apply(null, c.map(function (q) { return q.tw; })) < v.tSmin) p2.push('окно выборки ADCINA' + ch + ' меньше ' + v.tSmin + ' нс'); });
        if (A.warnKeys.indexOf('adcclk') >= 0) p2.push('ADCCLK выше 50 МГц');
        if (A.snapMain && !((A.snapMain.AdcaRegs.ADCCTL1 >> 2) & 1)) p2.push('INTPULSEPOS = 0');
        var stats = [];
        [['i_a', v.ch], ['i_b', v.chb]].forEach(function (pv) {
          var vt = A.logs.varX[pv[0]]; if (!vt || !vt.length) { p2.push('нет переменной ' + pv[0]); return; }
          var cs = tp.filter(function (q) { return q.ch === pv[1]; }), j = -1, sm = 0, mx = 0, n = 0;
          for (var k = 0; k < vt.length; k += 2) { var t = vt[k]; if (t < enA + 4 * T || t >= tj) continue; while (j + 1 < cs.length && cs[j + 1].tS <= t) j++; if (j < 0 || !isFinite(vt[k + 1])) continue; var e = vt[k + 1] - cs[j].i; sm += e; n++; if (Math.abs(e) > Math.abs(mx)) mx = e; }
          if (n < 10) { p2.push(pv[0] + ': нет измерений'); return; }
          sm /= n; stats.push(pv[0] + ' ' + fmt(sm * 1000, 0) + '/' + fmt(mx * 1000, 0) + ' мА');
          if (Math.abs(sm) > 0.005 * v.ifs || Math.abs(mx) > 0.02 * v.ifs) p2.push('погрешность ' + pv[0] + ': систематическая ' + fmt(sm * 1000, 0) + ' мА, наибольшая ' + fmt(mx * 1000, 0) + ' мА');
        });
      }
      out['И2'] = res(p2.length === 0, p2.length ? p2.join('; ') : 'погрешность (систематическая/наибольшая) ' + stats.join(', '));
      var Lg = A.logs, steady = trBefore.length === 0 && enA !== null;
      // И3, И4, И7
      if (!steady) { ['И3', 'И4', 'И6', 'И7'].forEach(function (k) { out[k] = bad(trBefore.length ? 'отключение защиты при t = ' + fmt(trBefore[0].t / HZ * 1000, 2) + ' мс' : 'выходы не включались'); }); }
      else {
        var ia = phasor(Lg.iS, Lg.dec, wa, wb, v.fn), ib = phasor(Lg.iS2, Lg.dec, wa, wb, v.fn);
        var dph = ((ang(ib) - ang(ia)) * 180 / Math.PI + 540) % 360 - 180;
        var u1 = phasorStep(Lg.vEd, A.endTick, wa, wa + (wb - wa) / 2, v.fn), u2 = phasorStep(Lg.vEd, A.endTick, wa + (wb - wa) / 2, wb, v.fn);
        var df = ((ang(u2) - ang(u1) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / (2 * Math.PI) * v.fn;   // сдвиг фазы за период
        var fmeas = v.fn + df, wEnd = 0, nW = 0;
        for (var k = Math.ceil(wa / Lg.dec); k < Math.floor(wb / Lg.dec); k++) { wEnd += Lg.wS[k]; nW++; }
        var nrot = wEnd / nW * 30 / Math.PI;
        var ok3 = Math.abs(fmeas - v.fn) <= 0.004 * v.fn && Math.abs(dph + 120) <= 5 && nrot > 0;
        out['И3'] = res(ok3, 'частота ' + fmt(fmeas, 2) + ' Гц, сдвиг тока фазы B ' + fmt(dph, 1) + '°, частота вращения ' + fmt(nrot, 0) + ' об/мин');
        var U1 = phasorStep(Lg.vEd, A.endTick, wa, wb, v.fn), u1m = mag(U1);
        // нулевая последовательность: 3-я гармоника коэффициента заполнения стойки A (CMPA ePWM1)
        var d1 = mag(phasorStep(Lg.cmpEv, A.endTick, wa, wb, v.fn)), k3 = d1 > 0 ? mag(phasorStep(Lg.cmpEv, A.endTick, wa, wb, 3 * v.fn)) / d1 * 100 : 0;
        out['И4'] = res(Math.abs(u1m - v.unm) <= 0.03 * v.unm && k3 >= 10, fmt(u1m, 1) + ' В (' + (u1m >= v.unm ? '+' : '') + fmt((u1m / v.unm - 1) * 100, 1) + ' %), 3-я гармоника коэффициента заполнения стойки A ' + fmt(k3, 1) + ' %');
        var iam = Math.max(mag(ia), mag(ib)), sl = 0.3 * (1500 - v.m.nn);
        out['И7'] = res(Math.abs(nrot - v.m.nn) <= sl && iam <= 1.1 * Math.SQRT2 * v.inom, 'частота вращения ' + fmt(nrot, 0) + ' об/мин, амплитуда тока ' + fmt(iam, 2) + ' А');
        // И6
        var ft = seriesIn(Lg.varT, t1, wb), ta = null, tb = null;
        ft.forEach(function (p) { if (ta === null && p.v >= 0.1 * v.fn) ta = p.t; if (tb === null && p.v >= 0.9 * v.fn) tb = p.t; });
        var p6 = [], rate = null;
        if (ta === null || tb === null) p6.push('f_out не достигает ' + fmt(0.9 * v.fn, 0) + ' Гц');
        else { rate = 0.8 * v.fn / ((tb - ta) / HZ); if (Math.abs(rate / (v.fn / v.tramp) - 1) > 0.05) p6.push('темп ' + fmt(rate, 0) + ' Гц/с'); }
        var ipk = 0; for (var q = Math.ceil(t1 / Lg.dec); q < Math.floor(wa / Lg.dec); q++) { var a1 = Lg.iS[q], b1 = Lg.iS2[q]; ipk = Math.max(ipk, Math.abs(a1), Math.abs(b1), Math.abs(a1 + b1)); }
        if (ipk > v.imax) p6.push('амплитуда тока при разгоне ' + fmt(ipk, 2) + ' А');
        out['И6'] = res(p6.length === 0, p6.length ? p6.join('; ') : 'темп ' + fmt(rate, 0) + ' Гц/с, амплитуда тока до ' + fmt(ipk, 2) + ' А');
      }
      // И5
      if (!live(B)) out['И5'] = bad('нет данных');
      else {
        var enB = enableTick(B), trB = enB === null ? [] : trips(B, Math.max(enB, 10));
        if (trB.length) out['И5'] = bad('отключение защиты при t = ' + fmt(trB[0].t / HZ * 1000, 2) + ' мс');
        else { var UL = mag(phasorStep(B.logs.vEd, B.endTick, Math.round(WB.a * HZ), Math.round(WB.b * HZ), v.flow)); out['И5'] = res(Math.abs(UL - v.ulow) <= 0.05 * v.ulow, fmt(UL, 1) + ' В (' + (UL >= v.ulow ? '+' : '') + fmt((UL / v.ulow - 1) * 100, 1) + ' %)'); }
      }
      // И8
      var trJ = trA.filter(function (q) { return q.t >= tj; });
      if (!steady) out['И8'] = bad('установившийся режим не достигнут');
      else {
        // момент превышения: первая выборка тока (середина нулевого вектора, TBCTR = TBPRD) выше уставки
        var tex = null, z = Lg.prdT;
        for (var p = 0; p < z.length && tex === null; p++) {
          if (z[p] < tj) continue;
          var q2 = Math.floor(z[p] / Lg.dec); if (q2 >= Lg.iS.length) break;
          var s1 = Lg.iS[q2], s2 = Lg.iS2[q2], mxp = Math.max(Math.abs(s1), Math.abs(s2), Math.abs(s1 + s2));
          if (mxp > v.imax) tex = z[p];
        }
        if (tex === null && trJ.length) {
          // отключение по измеренному току чуть ниже уставки (погрешность датчиков)
          var pkj = 0; for (var p3 = 0; p3 < z.length && z[p3] <= trJ[0].t; p3++) { if (z[p3] < tj) continue; var q3 = Math.floor(z[p3] / Lg.dec); if (q3 >= Lg.iS.length) break; pkj = Math.max(pkj, Math.abs(Lg.iS[q3]), Math.abs(Lg.iS2[q3]), Math.abs(Lg.iS[q3] + Lg.iS2[q3])); }
          if (pkj >= 0.95 * v.imax) tex = trJ[0].t; else out['И8'] = bad('отключение при амплитуде тока ' + fmt(pkj, 2) + ' А, ниже уставки ' + fmt(v.imax, 1) + ' А');
        }
        if (out['И8']) { }
        else if (tex === null) out['И8'] = bad('ток не превысил уставку');
        else {
          var eds = [0, 1, 2].map(function (i) { return Lg.ed[i]; }), offT = null;
          for (var tt = tex; tt <= A.endTick; tt += 10) { if (eds.every(function (e) { return levelAt(e.A, tt) !== 1 && levelAt(e.B, tt) !== 1 && edgesHigh(e.A, tt, A.endTick).length === 0 && edgesHigh(e.B, tt, A.endTick).length === 0; })) { offT = tt; break; } }
          if (offT === null) out['И8'] = bad('ключи не закрыты, отключений защиты: ' + trJ.length);
          else { var d8 = (offT - tex) / HZ; out['И8'] = res(d8 <= 2 / v.fsw + 1e-6, 'все ключи закрыты через ' + fmt(Math.max(0, d8) * 1e6, 0) + ' мкс после превышения уставки'); }
        }
      }
      // И9
      var p9 = [];
      [['A', A], ['B', B]].forEach(function (pp) {
        var x = pp[1]; if (!live(x)) return; var en = enableTick(x);
        if (en === null) { p9.push(pp[0] + ': выходы не включены'); return; }
        if (en === 0) p9.push(pp[0] + ': выходы не отключены на время калибровки');
        else if (en > t1) p9.push(pp[0] + ': выходы включены через ' + fmt(en / HZ * 1e3, 1) + ' мс');
        if (en > 0) [1, 2].forEach(function (mi) { var e = x.logs.ed[mi]; if (e && (edgesHigh(e.A, 10, en - 10).length || edgesHigh(e.B, 10, en - 10).length)) p9.push(pp[0] + ': стойка ' + 'ABC'[mi] + ' не отключена при калибровке'); });
        var tr = trips(x, Math.max(en, 10)).filter(function (q) { return pp[0] === 'B' || q.t < tj; });
        if (tr.length) p9.push(pp[0] + ': отключение при t = ' + fmt(tr[0].t / HZ * 1e3, 2) + ' мс');
      });
      out['И9'] = res(p9.length === 0, p9.length ? p9.join('; ') : 'выходы включены через ' + fmt((enA || 0) / HZ * 1e3, 1) + ' мс, ложных отключений нет');
      // И10
      var viol = [];
      [A, B].forEach(function (x) {
        if (!live(x)) return;
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        ['f_out', 'i_a', 'i_b'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };

  /* ------------------------------------------------------------ */
  /* Протокол                                                     */
  /* ------------------------------------------------------------ */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function protocolHtml(o) {
    // o: {lab, variant, who, group, date, hash, code, results, version, runInfo}
    var lab = o.lab, v = o.variant, rows = '', passed = 0;
    lab.tests.forEach(function (t, i) {
      var r = o.results[t.id];
      if (r.ok) passed++;
      rows += '<tr><td>' + (i + 1) + '</td><td>' + esc(t.name) + '</td><td>' + t.req(v) + '</td><td>' + esc(r.meas) + '</td><td class="' + (r.ok ? 'ok' : 'no') + '">' + (r.ok ? 'соответствует' : 'не соответствует') + '</td></tr>';
    });
    var all = passed === lab.tests.length;
    var data = lab.describe(v).map(function (d) { return '<tr><td>' + d[0] + '</td><td>' + d[1] + '</td></tr>'; }).join('');
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Протокол ЛР' + lab.no + ', вариант ' + v.n + '</title><style>' +
      'body{font-family:"Times New Roman",Times,serif;font-size:14pt;line-height:1.35;margin:20mm 15mm 20mm 30mm;color:#000;background:#fff}' +
      'h1{font-size:14pt;text-align:center;text-transform:uppercase;margin:0 0 4pt}h2{font-size:14pt;margin:14pt 0 6pt}' +
      'p{margin:4pt 0}.c{text-align:center}table{border-collapse:collapse;width:100%;font-size:12pt;margin:6pt 0}' +
      'td,th{border:1px solid #000;padding:3pt 5pt;vertical-align:top;text-align:left}th{font-weight:bold}' +
      '.ok{white-space:nowrap}.no{white-space:nowrap;font-weight:bold}pre{font-family:"Courier New",monospace;font-size:9pt;white-space:pre-wrap;border:1px solid #000;padding:6pt}' +
      '.meta td{border:0;padding:1pt 4pt 1pt 0}.mono{font-family:"Courier New",monospace;font-size:10pt;word-break:break-all}' +
      '</style></head><body>' +
      '<p class="c">Университет ИТМО<br>Факультет систем управления и робототехники</p>' +
      '<h1>Протокол приемочных испытаний</h1>' +
      '<p class="c">программы управления к лабораторной работе № ' + lab.no + '<br>«' + esc(lab.title) + '»</p>' +
      '<table class="meta"><tr><td>Исполнитель:</td><td>' + esc(o.who || '—') + '</td></tr><tr><td>Группа:</td><td>' + esc(o.group || '—') + '</td></tr>' +
      '<tr><td>Вариант:</td><td>' + v.n + '</td></tr><tr><td>Дата и время испытаний:</td><td>' + esc(o.date) + '</td></tr>' +
      '<tr><td>Средство испытаний:</td><td>Стенд C2000 ' + esc(o.version) + ', модель TMS320F2837xD</td></tr>' +
      '<tr><td>Контрольная сумма программы (SHA-256):</td><td class="mono">' + esc(o.hash) + '</td></tr></table>' +
      '<h2>1 Исходные данные варианта</h2><table>' + data + '</table>' +
      '<h2>2 Результаты испытаний</h2><table><tr><th>№</th><th>Наименование проверки</th><th>Требование</th><th>Результат измерения</th><th>Заключение</th></tr>' + rows + '</table>' +
      '<h2>3 Заключение</h2><p>Пройдено проверок: ' + passed + ' из ' + lab.tests.length + '. Программа ' + (all ? '<b>соответствует</b>' : '<b>не соответствует</b>') + ' требованиям программы и методики испытаний лабораторной работы № ' + lab.no + '.</p>' +
      '<h2>Приложение. Текст испытанной программы</h2><pre>' + esc(o.code) + '</pre>' +
      '</body></html>';
  }

  /* ------------------------------------------------------------ */
  /* ЛР6. Векторное управление СДПМ                               */
  /* ------------------------------------------------------------ */
  var PMS = [
    { pn: 0.2, p: 4, psi: 0.0300, rs: 3.2, ld: 9.0e-3, lq: 10.0e-3, jm: 0.19e-4 },
    { pn: 0.4, p: 4, psi: 0.0420, rs: 1.4, ld: 5.0e-3, lq: 5.8e-3, jm: 0.34e-4 },
    { pn: 0.75, p: 4, psi: 0.0560, rs: 0.65, ld: 2.8e-3, lq: 3.3e-3, jm: 1.13e-4 },
    { pn: 1.0, p: 5, psi: 0.0520, rs: 0.45, ld: 2.2e-3, lq: 2.6e-3, jm: 2.0e-4 },
    { pn: 1.5, p: 5, psi: 0.0600, rs: 0.28, ld: 1.6e-3, lq: 1.9e-3, jm: 2.9e-4 }
  ];
  function lr6Variant(n) {
    var v = { n: n }, r = rng(77777773 * n + 29);
    var b = lr1Variant(n);
    v.gpio = b.gpio;
    v.fsw = [8000, 10000, 16000][(n - 1) % 3];
    v.tbprd = Math.round(HZ / (2 * v.fsw));
    v.vdc = pick(r, [300, 310, 320]);
    v.mi = (n * 2 + 1) % PMS.length; var m = PMS[v.mi]; v.m = m;
    v.dtReq = 100 * Math.round(5 + 7 * r());                          // нс, 0,5..1,2 мкс
    v.dbTicks = v.dtReq / 10;
    v.ch = 2 + Math.floor(r() * 3); v.chb = v.ch + 1;
    v.tSmin = 5 * Math.round((75 + 225 * r()) / 5);
    v.acqps = Math.ceil(v.tSmin / 5 - 1e-9) - 1;
    v.lines = pick(r, [1000, 2000, 2500]); v.Z = 4 * v.lines;
    v.qerr = stepIn(r, 0.08, 0.20, 0.01); v.lerr = 0.015; v.ecc = 1e-4;
    v.nn = 3000; v.wn = v.nn * Math.PI / 30;
    v.tn = m.pn * 1000 / v.wn;
    v.im = v.tn / (1.5 * m.p * m.psi);                                // амплитуда номинального тока
    v.inom = v.im / Math.SQRT2;
    v.imax = r1(1.8 * v.im);
    v.sens = HALL_S[HALL_S.length - 1];
    for (var q = 0; q < HALL_S.length; q++) if (1.65 / HALL_S[q] >= 1.3 * v.imax) { v.sens = HALL_S[q]; break; }
    v.ifs = 1.65 / v.sens;
    v.pol = r() < 0.5 ? 1 : -1;
    v.bw = pick(r, [80, 120]);
    v.ial = r1(0.8 * v.im);
    v.tal = pick(r, [0.08, 0.10]);
    v.kj = stepIn(r, 0.5, 1.5, 0.1);
    v.jsum = sig2(m.jm * (1 + v.kj));
    v.tc = +(0.005 * v.tn).toFixed(4);
    var wnat = Math.sqrt(1.5 * m.p * m.p * m.psi * v.ial / v.jsum);
    v.bsoft = 2 * 1.0 * v.jsum * wnat;
    v.bstiff = v.tn / (0.002 * v.wn);
    v.delta0 = (r() < 0.5 ? -1 : 1) * (30 + 120 * r());                // начальный электрический угол, град
    v.th0 = v.delta0 * Math.PI / 180 / m.p;
    v.nlow = 300; v.nhigh = 2400;
    v.iq1 = r1(0.5 * v.im); v.id1 = -r1(0.3 * v.im); v.iq2 = r1(v.im);
    v.tcal = 256 / v.fsw;
    v.tal1 = v.tcal + v.tal;
    v.ta = v.tal1 + 0.005; v.t2 = v.ta + 0.03; v.t3 = v.t2 + 0.015;
    v.kp = m.lq / (2 / v.fsw); v.ki = m.rs / (2 / v.fsw);
    return v;
  }
  function pm6For(v, seed) {
    var r = rng(seed * 37 + 5), ch = [];
    [[v.ch, 0], [v.chb, 1]].forEach(function (c) { ch.push({ ch: c[0], ph: c[1], sens: v.sens, pol: v.pol, voff: (0.010 + 0.015 * r()) * (r() < 0.5 ? -1 : 1), gerr: (r() * 2 - 1) * 0.008 }); });
    return { type: 'hall2', chans: ch, ch: v.ch, sens: v.sens, pol: v.pol, voff: 0, gerr: 0, tauAmp: 1 / (2 * Math.PI * v.bw * 1e3), tauS: v.tSmin * 1e-9 / Math.log(8192) };
  }
  function pm6Motor(v) { var m = v.m; return { rs: m.rs, ld: m.ld, lq: m.lq, psi: m.psi, p: m.p, j: v.jsum, b: v.bsoft, wset: 0, tc: v.tc, tload: 0, th0: v.th0 }; }
  function enc6For(v, seed) { return { lines: v.lines, qerr: v.qerr, lerr: v.lerr, ecc: v.ecc, seed: seed }; }
  // средние за период ШИМ истинные токи осей d, q и момент
  function dqAvg(x, a, b) {
    var L = x.logs, z = L.zeroT, o = [];
    for (var p = 0; p + 1 < z.length; p++) {
      if (z[p] < a || z[p + 1] > b) continue;
      var sd = 0, sq = 0, st = 0, n = 0;
      for (var k = Math.ceil(z[p] / L.dec); k < Math.floor(z[p + 1] / L.dec) && k < L.idS.length; k++) { sd += L.idS[k]; sq += L.iqS[k]; st += L.teS[k]; n++; }
      if (n) o.push({ t: z[p + 1], d: sd / n, q: sq / n, te: st / n });
    }
    return o;
  }
  function stepDQ(av, ax, t0, t1, from, to) {
    var amp = to - from, sg = amp >= 0 ? 1 : -1, ext = null, t90 = null, fin = 0, nf = 0;
    av.forEach(function (p) { if (p.t < t0 || p.t > t1) return; var rel = (p[ax] - from) * sg; if (ext === null || rel > ext) ext = rel; if (t90 === null && rel >= 0.9 * Math.abs(amp)) t90 = p.t - t0; if (p.t > t1 - 0.002 * HZ) { fin += p[ax]; nf++; } });
    return { over: ext === null ? NaN : (ext / Math.abs(amp) - 1) * 100, t90: t90 === null ? null : t90 / HZ, fin: nf ? fin / nf : NaN };
  }
  // предельное время нарастания: 5 T_ШИМ или время, ограниченное напряжением, плюс 3 T_ШИМ
  function lr6TLim(v, L, di, nrpm, iq) {
    var m = v.m, we = m.p * nrpm * Math.PI / 30, ul = 0.96 * v.vdc / Math.sqrt(3) - we * m.psi - m.rs * Math.abs(iq);
    return Math.max(5 / v.fsw, ul > 0 ? 1.3 * L * 0.9 * Math.abs(di) / ul + 3 / v.fsw : 1);
  }
  function angErr(x, a, b) {
    var vt = x.logs.varX.theta_e, L = x.logs, sm = 0, mx = 0, n = 0;
    if (!vt) return null;
    for (var k = 0; k < vt.length; k += 2) {
      var t = vt[k]; if (t < a || t > b) continue; var q = Math.floor(t / L.dec); if (q >= L.thS.length) break;
      var e = vt[k + 1] - L.thS[q]; e = ((e + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; e *= 180 / Math.PI;
      sm += e; n++; if (Math.abs(e) > Math.abs(mx)) mx = e;
    }
    return n ? { mean: sm / n, max: mx, n: n } : null;
  }

  var LR6 = {
    id: 'lr6', no: 6,
    title: 'Векторное управление синхронным двигателем с постоянными магнитами',
    variants: 30,
    variant: lr6Variant,
    interfaceVars: ['id_ref', 'iq_ref', 'theta_e', 'i_d', 'i_q'],
    sense: function (v) { return pm6For(v, 1); },
    trace: 'i_q',
    demo: function (v) { var p = LR6.runs(v)[0].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), loadEvents: p.loadEvents.slice(), Tsim: p.Tsim, encoder: p.encoder, traceExtra: ['i_d', 'theta_e'] }; },
    describe: function (v) {
      var m = v.m;
      return [
        ['Напряжение звена U<sub>d</sub>', v.vdc + ' В (выпрямленное напряжение сети 220 В)'],
        ['Частота ШИМ, мертвое время', fmt(v.fsw / 1000, 0) + ' кГц, не менее ' + fmt(v.dtReq / 1000, 1) + ' мкс'],
        ['Вход nFAULT', 'GPIO' + v.gpio],
        ['Двигатель', 'СДПМ, ' + fmt(m.pn, 2) + ' кВт, ' + v.nn + ' об/мин, p = ' + m.p + ', M<sub>ном</sub> = ' + fmt(v.tn, 2) + ' Н·м, I<sub>ном</sub> = ' + fmt(v.inom, 2) + ' А (амплитуда ' + fmt(v.im, 2) + ' А)'],
        ['Параметры', 'R<sub>s</sub> = ' + fmt(m.rs, 2) + ' Ом, L<sub>d</sub> = ' + fmt(m.ld * 1000, 1) + ' мГн, L<sub>q</sub> = ' + fmt(m.lq * 1000, 1) + ' мГн, Ψ<sub>f</sub> = ' + fmt(m.psi, 4) + ' Вб'],
        ['Энкодер', fmt(v.lines, 0) + ' штрихов, eQEP1 (GPIO20, GPIO21, GPIO23)'],
        ['Датчики тока фаз A и B', 'Холла, ' + fmt(v.sens * 1000, 0) + ' мВ/А, ADCINA' + v.ch + ' и ADCINA' + v.chb + ', ' + (v.pol > 0 ? 'напряжение растет при токе в двигатель' : 'напряжение убывает при токе в двигатель') + ', окно выборки не менее ' + v.tSmin + ' нс'],
        ['Начальная ориентация', 'ток ' + fmt(v.ial, 1) + ' А по оси фазы A, время ' + fmt(v.tal * 1000, 0) + ' мс'],
        ['Уставка защиты по амплитуде тока I<sub>max</sub>', fmt(v.imax, 1) + ' А'],
        ['Нагрузочная машина', 'задает частоту вращения ' + v.nlow + ' и ' + v.nhigh + ' об/мин; J<sub>Σ</sub> = ' + String(v.jsum * 1e4).replace('.', ',') + ' кг·см²']
      ];
    },
    runs: function (v) {
      function base(seed, extra) { return Object.assign({ plant: 'pm3', Vdc: v.vdc, R: 1, L: 1, traceVar: 'i_q', traceExtra: ['i_a', 'i_b', 'theta_e', 'i_d'], seed: seed, sense: pm6For(v, seed), encoder: enc6For(v, seed), motor: pm6Motor(v) }, extra); }
      function dyn(nr) { return [{ t: v.ta, b: v.bstiff, wset: nr * Math.PI / 30, acc: nr * Math.PI / 30 / 0.02 }]; }
      return [
        { id: 'A', title: 'низкая скорость, скачки i_q и i_d', params: base(31000 + v.n, { Tsim: (v.t3 + 0.015) * 1e3, varEvents: [{ t: v.t2, name: 'iq_ref', value: v.iq1 }, { t: v.t3, name: 'id_ref', value: v.id1 }], loadEvents: dyn(v.nlow) }) },
        { id: 'B', title: 'высокая скорость, скачок i_q, сигнал nFAULT', params: base(32000 + v.n, { Tsim: (v.t3 + 0.003) * 1e3, varEvents: [{ t: v.t2, name: 'iq_ref', value: v.iq2 }], loadEvents: dyn(v.nhigh), faults: [{ pin: v.gpio, t0: v.t3, t1: v.t3 + 20e-6 }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'ШИМ трех стоек', req: function (v) { return 'частота ' + fmt(v.fsw / 1000, 0) + ' кГц ± 0,1 %, счетчики синхронны, мертвое время ' + fmt(v.dtReq / 1000, 1) + '…' + fmt((v.dtReq + 200) / 1000, 1) + ' мкс в каждой стойке, нет сквозного тока'; }, method: 'Режимы A и B.' },
      { id: 'И2', name: 'Измерение токов фаз', req: function (v) { return 'запуск АЦП при TBCTR = TBPRD, входы ADCINA' + v.ch + ' и ADCINA' + v.chb + ', окно не менее ' + v.tSmin + ' нс; погрешность i_a, i_b: систематическая не более 0,5 %, наибольшая не более 2 % диапазона ' + fmt(v.ifs, 1) + ' А'; }, method: 'Режим A.' },
      { id: 'И3', name: 'Подключение энкодера', req: function (v) { return 'QPOSMAX = 4N − 1 = ' + (v.Z - 1) + ', счет фронтов обоих каналов, угол theta_e нарастает при вращении в положительном направлении'; }, method: 'Режим B.' },
      { id: 'И4', name: 'Начальная ориентация и электрический угол', req: function (v) { return 'к концу ориентации ротор повернут к θ<sub>e</sub> = 0 ± 3°; ошибка theta_e: средняя не более 1,5°, наибольшая не более 4° (электрических)'; }, method: 'Режимы A и B после ориентации.' },
      { id: 'И5', name: 'Контуры тока на низкой скорости', req: function (v) { return 'скачки i_q: 0 → ' + fmt(v.iq1, 1) + ' А и i_d: 0 → ' + fmt(v.id1, 1) + ' А: перерегулирование не более 10 %, время нарастания до 0,9 не более ' + fmt(lr6TLim(v, v.m.lq, v.iq1, v.nlow, v.iq1) * 1e6, 0) + ' мкс (i_q) и ' + fmt(lr6TLim(v, v.m.ld, v.id1, v.nlow, v.iq1) * 1e6, 0) + ' мкс (i_d), установившаяся ошибка не более 2 % I<sub>m</sub>'; }, method: 'Режим A, ' + 'n = 300 об/мин; токи осей d, q в истинной системе координат ротора, усредненные за период ШИМ.' },
      { id: 'И6', name: 'Контуры тока на высокой скорости', req: function (v) { return 'скачок i_q: 0 → ' + fmt(v.iq2, 1) + ' А: перерегулирование не более 10 %, время нарастания до 0,9 не более ' + fmt(lr6TLim(v, v.m.lq, v.iq2, v.nhigh, v.iq2) * 1e6, 0) + ' мкс; отклонение i_d не более 12 % I<sub>m</sub>; установившаяся ошибка не более 3 % I<sub>m</sub>; при разгоне нагрузочной машиной и нулевых заданиях токи i_d, i_q не более 10 % I<sub>m</sub>'; }, method: 'Режим B: разгон нагрузочной машиной до 2400 об/мин за 20 мс, затем скачок задания.' },
      { id: 'И7', name: 'Электромагнитный момент', req: function (v) { return 'при i_q = ' + fmt(v.iq2, 1) + ' А момент ' + fmt(1.5 * v.m.p * v.m.psi * v.iq2, 3) + ' Н·м ± 3 %'; }, method: 'Режим B, среднее за 10 мс перед сигналом nFAULT.' },
      { id: 'И8', name: 'Аварийный сигнал драйверов', req: function () { return 'все шесть ключей закрыты не позднее 0,2 мкс после появления сигнала nFAULT и остаются закрытыми'; }, method: 'Режим B: импульс низкого уровня 20 мкс на входе nFAULT.' },
      { id: 'И9', name: 'Включение выходов', req: function (v) { return 'выходы трех стоек отключены при калибровке, включены до t = ' + fmt((v.tcal + 0.001) * 1000, 0) + ' мс, ложных отключений нет'; }, method: 'Режимы A и B.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные id_ref, iq_ref, theta_e, i_d, i_q, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, B = R.B, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      function live(x) { return x && !x.compileError; }
      if (!live(A) || !live(B)) { LR6.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + ((A && A.compileError) || (B && B.compileError) || 'нет результата')); }); return out; }
      var T = HZ / v.fsw, m = A.measures, t2 = Math.round(v.t2 * HZ), t3 = Math.round(v.t3 * HZ), tal1 = Math.round(v.tal1 * HZ), Im = v.im;
      function nearest(arr, t) { var lo = 0, hi = arr.length - 1, best = Infinity; while (lo <= hi) { var mid = (lo + hi) >> 1; var d = t - arr[mid]; if (Math.abs(d) < Math.abs(best)) best = d; if (arr[mid] < t) lo = mid + 1; else hi = mid - 1; } return best === Infinity ? 1e9 : best; }
      var enA = enableTick(A), enB = enableTick(B);
      var trA = enA === null ? [] : trips(A, Math.max(enA, 10)), trB = enB === null ? [] : trips(B, Math.max(enB, 10)).filter(function (q) { return q.t < t3; });
      // И1
      var p1 = [];
      if (!m.fpwm) p1.push('счетчик ePWM1 не работает'); else if (Math.abs(m.fpwm - v.fsw) / v.fsw > 0.001) p1.push('частота ' + fmt(m.fpwm / 1000, 3) + ' кГц');
      [['ePWM2', A.logs.zeroT2], ['ePWM3', A.logs.zeroT3]].forEach(function (z) { if (z[1].length < 3) { p1.push('счетчик ' + z[0] + ' не работает'); return; } var w1 = 0; z[1].slice(-100).forEach(function (t) { var d = nearest(A.logs.zeroT, t); if (Math.abs(d) > Math.abs(w1)) w1 = d; }); if (Math.abs(w1) > 1) p1.push('счетчик ' + z[0] + ' не синхронен с ePWM1'); });
      var dmn = Infinity, dmx = 0;
      [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA], ['C', m.dt3AB, m.dt3BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; dmn = Math.min(dmn, mn); dmx = Math.max(dmx, mx); if (mn < v.dtReq - 0.5 || mx > v.dtReq + 200.5) p1.push('мертвое время стойки ' + d[0] + ' ' + fmt(mn / 1000, 2) + '…' + fmt(mx / 1000, 2) + ' мкс'); });
      if (A.measures.shootN + B.measures.shootN) p1.push('сквозной ток');
      out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : fmt(m.fpwm / 1000, 3) + ' кГц, мертвое время ' + fmt(dmn / 1000, 2) + '…' + fmt(dmx / 1000, 2) + ' мкс');
      // И2
      var p2 = [], tp = adcTuples(A).filter(function (q) { return enA !== null && q.t0 > enA + T; }), stats = [];
      if (!tp.length) p2.push('АЦП не запускается');
      else {
        var wst = 0; tp.forEach(function (q) { if (q.soc !== 0) return; var dp = nearest(A.logs.prdT, q.t0); if (Math.abs(dp) > Math.abs(wst)) wst = dp; }); if (Math.abs(wst) > 5) p2.push('запуск АЦП не при TBCTR = TBPRD');
        [v.ch, v.chb].forEach(function (ch) { var c = tp.filter(function (q) { return q.ch === ch; }); if (!c.length) p2.push('ADCINA' + ch + ' не оцифровывается'); else if (Math.min.apply(null, c.map(function (q) { return q.tw; })) < v.tSmin) p2.push('окно выборки ADCINA' + ch + ' меньше ' + v.tSmin + ' нс'); });
        if (A.warnKeys.indexOf('adcclk') >= 0) p2.push('ADCCLK выше 50 МГц');
        [['i_a', v.ch], ['i_b', v.chb]].forEach(function (pv) {
          var vt = A.logs.varX[pv[0]]; if (!vt || !vt.length) { p2.push('нет переменной ' + pv[0]); return; }
          var cs = tp.filter(function (q) { return q.ch === pv[1]; }), j = -1, sm = 0, mx = 0, n = 0;
          for (var k = 0; k < vt.length; k += 2) { var t = vt[k]; if (t < enA + 4 * T) continue; while (j + 1 < cs.length && cs[j + 1].tS <= t) j++; if (j < 0 || !isFinite(vt[k + 1])) continue; var e = vt[k + 1] - cs[j].i; sm += e; n++; if (Math.abs(e) > Math.abs(mx)) mx = e; }
          if (n < 10) { p2.push(pv[0] + ': нет измерений'); return; }
          sm /= n; stats.push(pv[0] + ' ' + fmt(sm * 1000, 0) + '/' + fmt(mx * 1000, 0) + ' мА');
          if (Math.abs(sm) > 0.005 * v.ifs || Math.abs(mx) > 0.02 * v.ifs) p2.push('погрешность ' + pv[0] + ': систематическая ' + fmt(sm * 1000, 0) + ' мА, наибольшая ' + fmt(mx * 1000, 0) + ' мА');
        });
      }
      out['И2'] = res(p2.length === 0, p2.length ? p2.join('; ') : 'погрешность (систематическая/наибольшая) ' + stats.join(', '));
      // И3
      var p3 = [], sq = B.snapMain && B.snapMain.EQep1Regs;
      if (!sq) p3.push('нет данных');
      else {
        if ((sq.QPOSMAX >>> 0) !== v.Z - 1) p3.push('QPOSMAX = ' + (sq.QPOSMAX >>> 0));
        if ((sq.QDECCTL >> 10) & 1) p3.push('XCR = 1: счет фронтов одного канала');
      }
      var vtB = B.logs.varX.theta_e, adv = 0, nadv = 0;
      if (vtB) for (var k3 = 2; k3 < vtB.length; k3 += 2) { if (vtB[k3] < t2 - 0.01 * HZ || vtB[k3] > t3) continue; var dth = vtB[k3 + 1] - vtB[k3 - 1]; dth = ((dth + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; adv += dth; nadv++; }
      if (!vtB || !nadv) p3.push('нет переменной theta_e'); else if (adv <= 0) p3.push('угол theta_e убывает при вращении в положительном направлении');
      out['И3'] = res(p3.length === 0, p3.length ? p3.join('; ') : 'QPOSMAX = ' + (v.Z - 1) + ', приращение угла ' + fmt(adv / nadv * 180 / Math.PI, 2) + '° за период ШИМ');
      // И4
      var p4 = [], thEnd = A.logs.thS[Math.min(A.logs.thS.length - 1, Math.floor((tal1 - T) / A.logs.dec))];
      var e0 = ((thEnd + Math.PI) % (2 * Math.PI)) - Math.PI; e0 *= 180 / Math.PI;
      if (Math.abs(e0) > 3) p4.push('после ориентации θ<sub>e</sub> = ' + fmt(e0, 1) + '°');
      var ea = angErr(A, tal1 + 2 * T, A.endTick), eb = angErr(B, tal1 + 2 * T, t3);
      [['A', ea], ['B', eb]].forEach(function (z) { if (!z[1]) { p4.push(z[0] + ': нет переменной theta_e'); return; } if (Math.abs(z[1].mean) > 1.5 || Math.abs(z[1].max) > 4) p4.push(z[0] + ': ошибка угла средняя ' + fmt(z[1].mean, 2) + '°, наибольшая ' + fmt(z[1].max, 2) + '°'); });
      out['И4'] = res(p4.length === 0, p4.length ? p4.join('; ') : 'после ориентации θ<sub>e</sub> = ' + fmt(e0, 2) + '°; ошибка угла A: ' + fmt(ea.mean, 2) + '/' + fmt(ea.max, 2) + '°, B: ' + fmt(eb.mean, 2) + '/' + fmt(eb.max, 2) + '°');
      // И5
      if (trA.length) out['И5'] = bad('отключение защиты при t = ' + fmt(trA[0].t / HZ * 1e3, 2) + ' мс');
      else {
        var avA = dqAvg(A, t2 - 0.003 * HZ, A.endTick), sq1 = stepDQ(avA, 'q', t2, t3, 0, v.iq1), sd1 = stepDQ(avA, 'd', t3, A.endTick, 0, v.id1), p5 = [];
        [['i_q', sq1, v.iq1], ['i_d', sd1, v.id1]].forEach(function (z) {
          var s = z[1]; if (s.t90 === null) { p5.push(z[0] + ' не достигает 0,9 задания'); return; }
          if (s.over > 10) p5.push(z[0] + ': перерегулирование ' + fmt(s.over, 1) + ' %'); if (s.t90 > 1.001 * lr6TLim(v, z[0] === 'i_q' ? v.m.lq : v.m.ld, z[2], v.nlow, v.iq1)) p5.push(z[0] + ': время нарастания ' + fmt(s.t90 * 1e6, 0) + ' мкс'); if (Math.abs(s.fin - z[2]) > 0.02 * Im) p5.push(z[0] + ': ошибка ' + fmt(s.fin - z[2], 3) + ' А');
        });
        out['И5'] = res(p5.length === 0, p5.length ? p5.join('; ') : 'i_q: ' + fmt(sq1.over, 1) + ' %, ' + fmt(sq1.t90 * 1e6, 0) + ' мкс; i_d: ' + fmt(sd1.over, 1) + ' %, ' + fmt(sd1.t90 * 1e6, 0) + ' мкс');
      }
      // И6, И7
      if (trB.length) { out['И6'] = bad('отключение защиты при t = ' + fmt(trB[0].t / HZ * 1e3, 2) + ' мс'); out['И7'] = bad('отключение защиты'); }
      else {
        var avB = dqAvg(B, t2 - 0.003 * HZ, t3), sq2 = stepDQ(avB, 'q', t2, t3, 0, v.iq2), p6 = [], dmax = 0, dfin = 0, nd = 0, tsum = 0, nt = 0;
        avB.forEach(function (p) { if (p.t < t2) return; if (Math.abs(p.d) > Math.abs(dmax)) dmax = p.d; if (p.t > t3 - 0.002 * HZ) { dfin += p.d; nd++; } if (p.t > t3 - 0.010 * HZ) { tsum += p.te; nt++; } });
        dfin = nd ? dfin / nd : NaN;
        if (sq2.t90 === null) p6.push('i_q не достигает 0,9 задания');
        else { if (sq2.over > 10) p6.push('перерегулирование ' + fmt(sq2.over, 1) + ' %'); if (sq2.t90 > 1.001 * lr6TLim(v, v.m.lq, v.iq2, v.nhigh, v.iq2)) p6.push('время нарастания ' + fmt(sq2.t90 * 1e6, 0) + ' мкс'); if (Math.abs(sq2.fin - v.iq2) > 0.03 * Im) p6.push('ошибка i_q ' + fmt(sq2.fin - v.iq2, 3) + ' А'); }
        var accMax = 0; dqAvg(B, Math.round(v.ta * HZ), t2).forEach(function (p) { accMax = Math.max(accMax, Math.abs(p.d), Math.abs(p.q)); });
        if (accMax > 0.1 * Im) p6.push('ток при разгоне нагрузочной машиной ' + fmt(accMax, 2) + ' А');
        if (Math.abs(dmax) > 0.12 * Im) p6.push('отклонение i_d ' + fmt(dmax, 2) + ' А'); if (Math.abs(dfin) > 0.03 * Im) p6.push('ошибка i_d ' + fmt(dfin, 3) + ' А');
        out['И6'] = res(p6.length === 0, p6.length ? p6.join('; ') : 'i_q: ' + fmt(sq2.over, 1) + ' %, ' + fmt(sq2.t90 * 1e6, 0) + ' мкс; отклонение i_d ' + fmt(dmax, 3) + ' А; ток при разгоне до ' + fmt(accMax, 3) + ' А');
        var tref = 1.5 * v.m.p * v.m.psi * v.iq2, tm = nt ? tsum / nt : NaN;
        out['И7'] = res(Math.abs(tm / tref - 1) <= 0.03, fmt(tm, 3) + ' Н·м (' + (tm >= tref ? '+' : '') + fmt((tm / tref - 1) * 100, 1) + ' %)');
      }
      // И8
      var tf = t3, bads = [], worst = 0;
      if (enB === null || enB > tf) out['И8'] = bad('выходы не включены до появления сигнала');
      else {
        [0, 1, 2].forEach(function (mi) {
          var ed = B.logs.ed[mi], offAll = 0, ok = true;
          [ed.A, ed.B].forEach(function (e) { var off = levelAt(e, tf) === 1 ? null : tf; for (var k = 0; k < e.length; k += 2) { if (e[k] < tf) continue; if (e[k + 1] === 1) ok = false; else if (off === null) off = e[k]; } if (off === null) ok = false; else offAll = Math.max(offAll, off - tf); });
          if (!ok) bads.push('стойка ' + 'ABC'[mi] + ' не отключена'); else if (offAll > 20) bads.push('стойка ' + 'ABC'[mi] + ' отключена через ' + fmt(offAll * 10 / 1000, 2) + ' мкс');
          worst = Math.max(worst, offAll);
        });
        out['И8'] = res(bads.length === 0, bads.length ? bads.join('; ') : 'все ключи закрыты через ' + fmt(worst * 10 / 1000, 2) + ' мкс и остаются закрытыми');
      }
      // И9
      var p9 = [], tlim = Math.round((v.tcal + 0.001) * HZ);
      [['A', A, trA], ['B', B, trB]].forEach(function (pp) {
        var x = pp[1], en = enableTick(x);
        if (en === null) { p9.push(pp[0] + ': выходы не включены'); return; }
        if (en === 0) p9.push(pp[0] + ': выходы не отключены на время калибровки');
        else if (en > tlim) p9.push(pp[0] + ': выходы включены через ' + fmt(en / HZ * 1e3, 1) + ' мс');
        if (en > 0) [1, 2].forEach(function (mi) { var e = x.logs.ed[mi]; if (e && (edgesHigh(e.A, 10, en - 10).length || edgesHigh(e.B, 10, en - 10).length)) p9.push(pp[0] + ': стойка ' + 'ABC'[mi] + ' не отключена при калибровке'); });
        if (pp[2].length) p9.push(pp[0] + ': отключение при t = ' + fmt(pp[2][0].t / HZ * 1e3, 2) + ' мс');
      });
      out['И9'] = res(p9.length === 0, p9.length ? p9.join('; ') : 'выходы включены через ' + fmt((enA || 0) / HZ * 1e3, 1) + ' мс, ложных отключений нет');
      // И10
      var viol = [];
      [A, B].forEach(function (x) {
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        ['theta_e', 'i_d', 'i_q', 'i_a', 'i_b'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };

  /* ------------------------------------------------------------ */
  /* ЛР7. Сервопривод с СДПМ                                       */
  /* ------------------------------------------------------------ */
  function trajT(d, vm, am) { d = Math.abs(d); return d >= vm * vm / am ? d / vm + vm / am : 2 * Math.sqrt(d / am); }
  // положение по непрерывному трапецеидальному графику, рад
  function trajPos(d, vm, am, t) {
    var s = d >= 0 ? 1 : -1; d = Math.abs(d); if (t <= 0) return 0;
    var ta = Math.min(vm / am, Math.sqrt(d / am)), vp = am * ta, tc = d >= vm * vm / am ? (d - vm * vm / am) / vm : 0, T = 2 * ta + tc, x;
    if (t < ta) x = 0.5 * am * t * t; else if (t < ta + tc) x = 0.5 * am * ta * ta + vp * (t - ta); else if (t < T) { var r = T - t; x = d - 0.5 * am * r * r; } else x = d;
    return s * x;
  }
  function lr7Variant(n) {
    var v = lr6Variant(n), r = rng(55555333 * n + 7);
    v.n = n;
    v.nw = Math.round(v.fsw * 0.0005); v.tw = v.nw / v.fsw; v.tmuw = 2 / v.fsw + v.tw;
    v.km = 1.5 * v.m.p * v.m.psi;
    v.ilim = r1(1.5 * v.im);
    v.vmaxn = pick(r, [1500, 2000, 2500]); v.vmax = v.vmaxn * Math.PI / 30;
    v.amax = Math.round(0.7 * v.tn / v.jsum / 100) * 100;
    v.dist = pick(r, [2, 3, 4]); v.dist2 = -0.5;
    v.mload = +(0.5 * v.tn).toFixed(3); v.mover = +(2.0 * v.tn).toFixed(3);
    v.kpw = v.jsum / (2 * v.km * v.tmuw); v.kiw = v.kpw / (4 * v.tmuw); v.kpos = 1 / (8 * v.tmuw);
    v.t1 = v.tal1 + 0.01;
    v.TA = trajT(v.dist * 2 * Math.PI, v.vmax, v.amax); v.TB = trajT(v.dist2 * 2 * Math.PI, v.vmax, v.amax);
    v.tA2 = v.t1 + v.TA + 0.03; v.tA3 = v.tA2 + 0.03; v.tAe = v.tA3 + 0.03;
    v.tB2 = v.t1 + v.TB + 0.02; v.tB3 = v.tB2 + 0.015; v.tBe = v.tB3 + 0.07;
    return v;
  }
  function pmPos(x, k, k0) { return x.logs.pmS[k] - x.logs.pmS[k0]; }
  var LR7 = {
    id: 'lr7', no: 7,
    title: 'Сервопривод с синхронным двигателем с постоянными магнитами',
    variants: 30,
    variant: lr7Variant,
    interfaceVars: ['pos_ref', 'pos_meas', 'n_meas', 'iq_ref', 'theta_e'],
    sense: function (v) { return pm6For(v, 1); },
    trace: 'pos_meas',
    demo: function (v) { var p = LR7.runs(v)[0].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), loadEvents: p.loadEvents.slice(), Tsim: p.Tsim, encoder: p.encoder, traceExtra: ['n_meas', 'iq_ref'] }; },
    describe: function (v) {
      var d = LR6.describe(v).filter(function (q) { return q[0].indexOf('Нагрузочная') < 0; });
      return d.concat([
        ['Механическая часть', 'J<sub>Σ</sub> = ' + String(v.jsum * 1e4).replace('.', ',') + ' кг·см², момент трения ' + fmt(v.tc * 1000, 1) + ' мН·м; нагрузочная машина после ориентации создает заданный момент'],
        ['Контур скорости', 'период N<sub>ω</sub> = ' + v.nw + ' периодов ШИМ, ограничение тока I<sub>огр</sub> = ' + fmt(v.ilim, 1) + ' А'],
        ['Задатчик перемещения', 'наибольшая скорость ' + v.vmaxn + ' об/мин, ускорение ' + v.amax + ' рад/с²'],
        ['Испытательные перемещения', fmt(v.dist, 0) + ' об (режим A) и ' + fmt(v.dist2, 1) + ' об (режим B); наброс момента ' + fmt(v.mload, 3) + ' Н·м, перегрузка ' + fmt(v.mover, 3) + ' Н·м']
      ]);
    },
    runs: function (v) {
      function base(seed, extra) { return Object.assign({ plant: 'pm3', Vdc: v.vdc, R: 1, L: 1, traceVar: 'pos_meas', traceExtra: ['i_a', 'i_b', 'theta_e', 'iq_ref', 'n_meas'], seed: seed, sense: pm6For(v, seed), encoder: enc6For(v, seed), motor: pm6Motor(v) }, extra); }
      var free = { t: v.tal1 + 0.002, b: 0 };
      return [
        { id: 'A', title: 'перемещение на ' + v.dist + ' об, наброс момента', params: base(41000 + v.n, { Tsim: v.tAe * 1e3, varEvents: [{ t: v.t1, name: 'pos_ref', value: v.dist }], loadEvents: [free, { t: v.tA2, tload: v.mload }, { t: v.tA3, tload: 0 }] }) },
        { id: 'B', title: 'перемещение на ' + v.dist2 + ' об, перегрузка', params: base(42000 + v.n, { Tsim: v.tBe * 1e3, varEvents: [{ t: v.t1, name: 'pos_ref', value: v.dist2 }], loadEvents: [free, { t: v.tB2, tload: v.mover }, { t: v.tB3, tload: 0 }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'Силовая часть, ориентация и контур тока', req: function (v) { return 'частота ШИМ ' + fmt(v.fsw / 1000, 0) + ' кГц ± 0,1 %, мертвое время ' + fmt(v.dtReq / 1000, 1) + '…' + fmt((v.dtReq + 200) / 1000, 1) + ' мкс, нет сквозного тока; ошибка угла theta_e после ориентации средняя не более 1,5°, наибольшая не более 4°'; }, method: 'Режимы A и B.' },
      { id: 'И2', name: 'Период контура скорости', req: function (v) { return 'задание тока iq_ref обновляется один раз за N<sub>ω</sub> = ' + v.nw + ' периодов ШИМ'; }, method: 'Режим A, движение.' },
      { id: 'И3', name: 'Измерение положения и скорости', req: function (v) { return 'погрешность pos_meas не более 2 импульсов (' + fmt(2 / v.Z * 360, 3) + '°); погрешность n_meas относительно средней скорости за период контура не более ' + fmt(60 / (v.Z * v.tw) * 1.5, 1) + ' об/мин'; }, method: 'Режим A, перемещение.' },
      { id: 'И4', name: 'Задатчик перемещения', req: function (v) { return 'наибольшая частота вращения не более ' + fmt(lr7NMax(v), 0) + ' об/мин; положение входит в зону ±10 импульсов не позднее ' + fmt((v.TA + 0.015) * 1000, 0) + ' мс после команды'; }, method: 'Режим A.' },
      { id: 'И5', name: 'Точность позиционирования', req: function (v) { return 'перерегулирование по положению не более 20 импульсов, установившаяся ошибка не более 3 импульсов'; }, method: 'Режимы A и B: 5 мс перед набросом момента.' },
      { id: 'И6', name: 'Ошибка слежения', req: function (v) { return 'отклонение положения от трапецеидального графика с V<sub>max</sub> и ε<sub>max</sub> при движении не более ' + fmt(lr7Follow(v) / (2 * Math.PI) * v.Z, 0) + ' импульсов'; }, method: 'Режим A, от команды до окончания графика.' },
      { id: 'И7', name: 'Наброс момента нагрузки', req: function (v) { return 'наибольшее отклонение положения не более ' + fmt(lr7Dev(v) / (2 * Math.PI) * v.Z, 0) + ' импульсов, через 25 мс ошибка не более 3 импульсов'; }, method: 'Режим A: момент ' + '0,5 M<sub>ном</sub> в течение 30 мс в положении покоя.' },
      { id: 'И8', name: 'Перегрузка', req: function (v) { return 'ток i_q не более 1,05 I<sub>огр</sub>, без отключения защиты; после снятия перегрузки возврат в заданное положение с перерегулированием не более ' + fmt(lr7Over(v) / (2 * Math.PI) * v.Z, 0) + ' импульсов, ошибка в конце режима не более 3 импульсов'; }, method: 'Режим B: момент 2 M<sub>ном</sub> в течение 15 мс в положении покоя.' },
      { id: 'И9', name: 'Включение выходов', req: function (v) { return 'выходы трех стоек отключены при калибровке, включены не позднее 1 мс после ее окончания, ложных отключений нет'; }, method: 'Режимы A и B.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные pos_ref, pos_meas, n_meas, iq_ref, theta_e, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, B = R.B, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      function live(x) { return x && !x.compileError; }
      if (!live(A) || !live(B)) { LR7.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + ((A && A.compileError) || (B && B.compileError) || 'нет результата')); }); return out; }
      var HZt = HZ, T = HZ / v.fsw, m = A.measures, Z = v.Z, cnt = Z / (2 * Math.PI);
      var tal1 = Math.round(v.tal1 * HZ), t1 = Math.round(v.t1 * HZ);
      function nearest(arr, t) { var lo = 0, hi = arr.length - 1, best = Infinity; while (lo <= hi) { var mid = (lo + hi) >> 1; var d = t - arr[mid]; if (Math.abs(d) < Math.abs(best)) best = d; if (arr[mid] < t) lo = mid + 1; else hi = mid - 1; } return best === Infinity ? 1e9 : best; }
      var enA = enableTick(A), enB = enableTick(B), trA = enA === null ? [] : trips(A, Math.max(enA, 10)), trB = enB === null ? [] : trips(B, Math.max(enB, 10));
      var kA0 = Math.floor(tal1 / A.logs.dec), kB0 = Math.floor(tal1 / B.logs.dec);
      function posAt(x, k0, t) { var k = Math.min(x.logs.iN - 1, Math.floor(t / x.logs.dec)); return pmPos(x, k, k0); }
      // И1
      var p1 = [];
      if (!m.fpwm) p1.push('счетчик ePWM1 не работает'); else if (Math.abs(m.fpwm - v.fsw) / v.fsw > 0.001) p1.push('частота ' + fmt(m.fpwm / 1000, 3) + ' кГц');
      [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA], ['C', m.dt3AB, m.dt3BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; if (mn < v.dtReq - 0.5 || mx > v.dtReq + 200.5) p1.push('мертвое время стойки ' + d[0] + ' ' + fmt(mn / 1000, 2) + '…' + fmt(mx / 1000, 2) + ' мкс'); });
      if (A.measures.shootN + B.measures.shootN) p1.push('сквозной ток');
      var ea = angErr(A, tal1 + 2 * T, A.endTick);
      if (!ea) p1.push('нет переменной theta_e'); else if (Math.abs(ea.mean) > 1.5 || Math.abs(ea.max) > 4) p1.push('ошибка угла средняя ' + fmt(ea.mean, 2) + '°, наибольшая ' + fmt(ea.max, 2) + '°');
      out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : fmt(m.fpwm / 1000, 3) + ' кГц, ошибка угла ' + fmt(ea.mean, 2) + '/' + fmt(ea.max, 2) + '°');
      // И2
      var vi = A.logs.varX.iq_ref, gaps = [], last = null;
      var lastv = null; if (vi) for (var k = 0; k < vi.length; k += 2) { var t = vi[k]; if (t < t1 || t > t1 + v.TA * HZ) continue; if (vi[k + 1] === lastv) continue; lastv = vi[k + 1]; if (last !== null) gaps.push(Math.round((t - last) / T)); last = t; }
      if (!vi || gaps.length < 10) out['И2'] = bad('задание iq_ref не изменяется');
      else { var okg = gaps.filter(function (g) { return g === v.nw; }).length / gaps.length; out['И2'] = res(okg >= 0.95, 'интервал между изменениями iq_ref ' + v.nw + ' периодов ШИМ в ' + fmt(okg * 100, 1) + ' % случаев'); }
      // И3
      var p3 = [], vp = A.logs.varT, vn = A.logs.varX.n_meas, ep = 0, en = 0, nn = 0, np = 0;
      var lp = null, ln = null; if (vp) for (var k = 0; k < vp.length; k += 2) { var t = vp[k]; if (t < t1 || t > A.endTick || vp[k + 1] === lp) continue; lp = vp[k + 1]; var e = (vp[k + 1] - posAt(A, kA0, t) / (2 * Math.PI)) * Z; if (Math.abs(e) > Math.abs(ep)) ep = e; np++; }
      if (vn) for (var k = 0; k < vn.length; k += 2) { var t = vn[k]; if (t < t1 + v.tw * HZ || t > A.endTick || vn[k + 1] === ln) continue; ln = vn[k + 1]; var w0 = (posAt(A, kA0, t) - posAt(A, kA0, t - v.tw * HZ)) / v.tw * 30 / Math.PI, e = vn[k + 1] - w0; if (Math.abs(e) > Math.abs(en)) en = e; nn++; }
      if (!np) p3.push('нет переменной pos_meas'); else if (Math.abs(ep) > 2.5) p3.push('погрешность положения ' + fmt(ep, 1) + ' импульсов');
      if (!nn) p3.push('нет переменной n_meas'); else if (Math.abs(en) > 60 / (Z * v.tw) * 1.5) p3.push('погрешность скорости ' + fmt(en, 1) + ' об/мин');
      out['И3'] = res(p3.length === 0, p3.length ? p3.join('; ') : 'положение ' + fmt(ep, 1) + ' имп., скорость ' + fmt(en, 1) + ' об/мин');
      // И4, И5, И6 (режим A)
      var dRad = v.dist * 2 * Math.PI, tA2 = Math.round(v.tA2 * HZ), tA3 = Math.round(v.tA3 * HZ), L = A.logs;
      var nmax = 0, tin = null, fol = 0, overA = 0;
      for (var k = Math.ceil(t1 / L.dec); k < Math.floor(tA2 / L.dec); k += 5) {
        var t = k * L.dec, x = pmPos(A, k, kA0);
        nmax = Math.max(nmax, Math.abs(L.wS[k]) * 30 / Math.PI);
        if (tin === null && Math.abs(x - dRad) * cnt <= 10) tin = t;
        if (tin !== null && Math.abs(x - dRad) * cnt > 10) tin = null;
        if (t <= t1 + v.TA * HZ) fol = Math.max(fol, Math.abs(x - trajPos(dRad, v.vmax, v.amax, (t - t1) / HZ)));
        overA = Math.max(overA, (x - dRad) * cnt);
      }
      var p4 = [];
      if (nmax > lr7NMax(v)) p4.push('частота вращения до ' + fmt(nmax, 0) + ' об/мин');
      if (tin === null) p4.push('положение не входит в зону ±10 импульсов'); else if ((tin - t1) / HZ > v.TA + 0.015) p4.push('вход в зону через ' + fmt((tin - t1) / HZ * 1000, 1) + ' мс');
      out['И4'] = res(p4.length === 0, p4.length ? p4.join('; ') : 'n до ' + fmt(nmax, 0) + ' об/мин, вход в зону через ' + fmt((tin - t1) / HZ * 1000, 1) + ' мс (график ' + fmt(v.TA * 1000, 1) + ' мс)');
      function finErr(x, k0, a, b, target) { var mx = 0, L2 = x.logs; for (var k = Math.ceil(a / L2.dec); k < Math.floor(b / L2.dec); k += 5) mx = Math.max(mx, Math.abs(pmPos(x, k, k0) - target) * cnt); return mx; }
      var tB2 = Math.round(v.tB2 * HZ), d2 = v.dist2 * 2 * Math.PI, LB = B.logs, overB = 0;
      for (var k = Math.ceil(t1 / LB.dec); k < Math.floor(tB2 / LB.dec); k += 5) overB = Math.max(overB, -(pmPos(B, k, kB0) - d2) * cnt);
      var fA = finErr(A, kA0, tA2 - 0.005 * HZ, tA2, dRad), fB = finErr(B, kB0, tB2 - 0.005 * HZ, tB2, d2), p5 = [];
      if (trA.length) p5.push('отключение защиты');
      if (Math.max(overA, overB) > 20) p5.push('перерегулирование ' + fmt(Math.max(overA, overB), 0) + ' импульсов');
      if (Math.max(fA, fB) > 3) p5.push('ошибка ' + fmt(Math.max(fA, fB), 1) + ' импульсов');
      out['И5'] = res(p5.length === 0, p5.length ? p5.join('; ') : 'перерегулирование ' + fmt(Math.max(overA, overB, 0), 1) + ' имп., ошибка A ' + fmt(fA, 1) + ', B ' + fmt(fB, 1) + ' имп.');
      var fl = lr7Follow(v);
      out['И6'] = res(fol <= fl, 'наибольшее отклонение ' + fmt(fol * cnt, 0) + ' импульсов (' + fmt(fol / (2 * Math.PI) * 360, 2) + '°)');
      // И7
      var dev = 0; for (var k = Math.ceil(tA2 / L.dec); k < Math.floor(tA3 / L.dec); k += 5) dev = Math.max(dev, Math.abs(pmPos(A, k, kA0) - dRad));
      var f7 = finErr(A, kA0, tA3 - 0.005 * HZ, tA3, dRad), dl = lr7Dev(v);
      out['И7'] = res(dev <= dl && f7 <= 3, 'наибольшее отклонение ' + fmt(dev * cnt, 0) + ' импульсов, через 25 мс ' + fmt(f7, 1) + ' имп.');
      // И8
      var tB3 = Math.round(v.tB3 * HZ), iqm = 0, ov8 = 0, p8 = [];
      dqAvg(B, tB2 - 0.002 * HZ, B.endTick).forEach(function (p) { iqm = Math.max(iqm, Math.abs(p.q)); });
      for (var k = Math.ceil(tB3 / LB.dec); k < LB.iN; k += 5) ov8 = Math.max(ov8, (pmPos(B, k, kB0) - d2));
      var f8 = finErr(B, kB0, B.endTick - 0.003 * HZ, B.endTick, d2);
      if (trB.length) p8.push('отключение защиты при t = ' + fmt(trB[0].t / HZ * 1e3, 2) + ' мс');
      if (iqm > 1.05 * v.ilim) p8.push('ток i_q до ' + fmt(iqm, 2) + ' А');
      if (ov8 > lr7Over(v)) p8.push('перерегулирование ' + fmt(ov8 * cnt, 0) + ' импульсов');
      if (f8 > 3) p8.push('ошибка в конце ' + fmt(f8, 1) + ' имп.');
      out['И8'] = res(p8.length === 0, p8.length ? p8.join('; ') : 'ток i_q до ' + fmt(iqm, 2) + ' А, перерегулирование ' + fmt(Math.max(0, ov8) * cnt, 0) + ' имп., ошибка в конце ' + fmt(f8, 1) + ' имп.');
      // И9
      var p9 = [], tlim = Math.round((v.tcal + 0.001) * HZ);
      [['A', A, trA], ['B', B, trB]].forEach(function (pp) {
        var x = pp[1], en = enableTick(x);
        if (en === null) { p9.push(pp[0] + ': выходы не включены'); return; }
        if (en === 0) p9.push(pp[0] + ': выходы не отключены на время калибровки'); else if (en > tlim) p9.push(pp[0] + ': выходы включены через ' + fmt(en / HZ * 1e3, 1) + ' мс');
        if (pp[2].length) p9.push(pp[0] + ': отключение при t = ' + fmt(pp[2][0].t / HZ * 1e3, 2) + ' мс');
      });
      out['И9'] = res(p9.length === 0, p9.length ? p9.join('; ') : 'выходы включены через ' + fmt((enA || 0) / HZ * 1e3, 1) + ' мс, ложных отключений нет');
      // И10
      var viol = [];
      [A, B].forEach(function (x) {
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        ['pos_meas', 'n_meas', 'iq_ref', 'theta_e'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };
  // допуски (рад): ошибка слежения, отклонение при набросе, перерегулирование после перегрузки
  function lr7Follow(v) { return 0.4 * v.vmax * v.tw + 15 * 2 * Math.PI / v.Z; }
  function lr7Dev(v) { return 1.5 * 6 * v.mload / v.jsum * v.tmuw * v.tmuw + 3 * 2 * Math.PI / v.Z; }
  function lr7Over(v) { return 100 * 2 * Math.PI / v.Z; }
  function lr7NMax(v) { return 1.05 * v.vmaxn + v.amax * v.tmuw * 30 / Math.PI; }

  /* ------------------------------------------------------------ */
  /* ЛР8. Идентификация параметров СДПМ                            */
  /* ------------------------------------------------------------ */
  function lr8Variant(n) {
    var v = lr6Variant(n), r = rng(31415927 * n + 3), m = v.m;
    v.n = n;
    v.nw = Math.round(v.fsw * 0.0005); v.tw = v.nw / v.fsw;
    v.kR = stepIn(r, 1.10, 1.30, 0.01); v.kLd = stepIn(r, 0.82, 0.95, 0.01); v.kLq = stepIn(r, 0.82, 0.95, 0.01); v.kPsi = stepIn(r, 0.90, 0.97, 0.01);
    v.mt = { pn: m.pn, p: m.p, rs: m.rs * v.kR, ld: m.ld * v.kLd, lq: m.lq * v.kLq, psi: m.psi * v.kPsi, jm: m.jm };
    v.tL = (2 * 4 + 1) * 24 / v.fsw;
    v.tJend = v.tal1 + v.tL + 0.02 + 0.03;
    v.tpsi = v.tJend + 0.01; v.npsi = 1500;
    v.tv = v.tpsi + 0.06; v.iqv = r1(0.5 * v.im); v.tend = v.tv + 0.015;
    var T = 1 / v.fsw, mt = v.mt, km = 1.5 * mt.p * mt.psi, tmw = 2 * T + v.tw;
    v.true = { r: mt.rs, ld: mt.ld, lq: mt.lq, psi: mt.psi, j: v.jsum, kpd: mt.ld / (2 * T), kpq: mt.lq / (2 * T), ki: mt.rs / (2 * T), kpw: v.jsum / (2 * km * tmw), kiw: v.jsum / (2 * km * tmw) / (4 * tmw) };
    return v;
  }
  function pm8Motor(v) { var m = v.mt; return { rs: m.rs, ld: m.ld, lq: m.lq, psi: m.psi, p: m.p, j: v.jsum, b: v.bsoft, wset: 0, tc: v.tc, tload: 0, th0: v.th0 }; }
  var LR8 = {
    id: 'lr8', no: 8,
    title: 'Идентификация параметров синхронного двигателя и автоматическая настройка регуляторов',
    variants: 30,
    variant: lr8Variant,
    interfaceVars: ['r_id', 'ld_id', 'lq_id', 'psi_id', 'j_id', 'iq_ref', 'theta_e'],
    sense: function (v) { return pm6For(v, 1); },
    trace: 'i_q',
    demo: function (v) { var p = LR8.runs(v)[0].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), loadEvents: p.loadEvents.slice(), Tsim: p.Tsim, encoder: p.encoder, traceExtra: ['i_d', 'theta_e'] }; },
    describe: function (v) {
      var d = LR6.describe(v).filter(function (q) { return q[0].indexOf('Нагрузочная') < 0 && q[0].indexOf('Параметры') < 0; });
      var m = v.m;
      return d.concat([
        ['Паспортные параметры', 'R<sub>s</sub> = ' + fmt(m.rs, 2) + ' Ом (при 20 °C), L<sub>d</sub> = ' + fmt(m.ld * 1000, 1) + ' мГн, L<sub>q</sub> = ' + fmt(m.lq * 1000, 1) + ' мГн, Ψ<sub>f</sub> = ' + fmt(m.psi, 4) + ' Вб, J<sub>дв</sub> = ' + fmt(m.jm * 1e4, 2) + ' кг·см²; действительные значения отличаются'],
        ['Нагрузочная машина', 'во время ориентации демпфирует ротор, затем отключена; в момент ' + fmt(v.tpsi * 1000, 0) + ' мс разгоняет вал до ' + v.npsi + ' об/мин'],
        ['Проверка настройки', 'скачок i_q: 0 → ' + fmt(v.iqv, 1) + ' А при ' + fmt(v.tv * 1000, 0) + ' мс']
      ]);
    },
    runs: function (v) {
      var p = { plant: 'pm3', Vdc: v.vdc, R: 1, L: 1, traceVar: 'i_q', traceExtra: ['i_a', 'i_b', 'theta_e', 'i_d', 'id_done'], seed: 51000 + v.n, sense: pm6For(v, 51000 + v.n), encoder: enc6For(v, 51000 + v.n), motor: pm8Motor(v),
        Tsim: v.tend * 1e3, varEvents: [{ t: v.tv, name: 'iq_ref', value: v.iqv }],
        loadEvents: [{ t: v.tal1 + 0.001, b: 0 }, { t: v.tpsi, b: v.bstiff, wset: v.npsi * Math.PI / 30, acc: v.npsi * Math.PI / 30 / 0.02 }] };
      return [{ id: 'A', title: 'идентификация и проверка настройки', params: p }];
    },
    tests: [
      { id: 'И1', name: 'Силовая часть и ориентация', req: function (v) { return 'частота ШИМ ' + fmt(v.fsw / 1000, 0) + ' кГц ± 0,1 %, мертвое время ' + fmt(v.dtReq / 1000, 1) + '…' + fmt((v.dtReq + 200) / 1000, 1) + ' мкс, нет сквозного тока; ошибка угла theta_e средняя не более 1,5°, наибольшая не более 4°'; }, method: 'Режим A после ориентации.' },
      { id: 'И2', name: 'Сопротивление фазы', req: function (v) { return 'r_id = ' + fmt(v.true.r, 3) + ' Ом ± 3 %'; }, method: 'Значение переменной в конце режима.' },
      { id: 'И3', name: 'Индуктивности', req: function (v) { return 'ld_id = ' + fmt(v.true.ld * 1e3, 3) + ' мГн ± 6 %, lq_id = ' + fmt(v.true.lq * 1e3, 3) + ' мГн ± 6 %'; }, method: 'Значения переменных в конце режима.' },
      { id: 'И4', name: 'Потокосцепление магнитов', req: function (v) { return 'psi_id = ' + fmt(v.true.psi, 5) + ' Вб ± 3 %'; }, method: 'Значение переменной в конце режима.' },
      { id: 'И5', name: 'Момент инерции', req: function (v) { return 'j_id = ' + fmt(v.true.j * 1e4, 3) + ' кг·см² ± 5 %'; }, method: 'Значение переменной в конце режима.' },
      { id: 'И6', name: 'Коэффициенты регуляторов тока', req: function (v) { return 'kp_d = ' + fmt(v.true.kpd, 2) + ', kp_q = ' + fmt(v.true.kpq, 2) + ' В/А, ki_i = ' + fmt(v.true.ki, 0) + ' В/(А·с), каждый ± 7 %'; }, method: 'Технический оптимум по действительным параметрам.' },
      { id: 'И7', name: 'Коэффициенты регулятора скорости', req: function (v) { return 'kp_w = ' + fmt(v.true.kpw, 4) + ' А·с/рад, ki_w = ' + fmt(v.true.kiw, 1) + ' А/рад, каждый ± 8 %'; }, method: 'Симметричный оптимум по действительным J и Ψ<sub>f</sub>, N<sub>ω</sub> = ' + '4..8.' },
      { id: 'И8', name: 'Контур тока после настройки', req: function (v) { return 'скачок i_q: 0 → ' + fmt(v.iqv, 1) + ' А при ' + v.npsi + ' об/мин: перерегулирование не более 10 %, время нарастания до 0,9 не более предельного, отклонение i_d не более 12 % I<sub>m</sub>, установившаяся ошибка не более 3 % I<sub>m</sub>'; }, method: 'Токи в истинной системе координат ротора, усредненные за период ШИМ.' },
      { id: 'И9', name: 'Ход идентификации и защита', req: function (v) { return 'выходы отключены при калибровке и включены не позднее 1 мс после ее окончания; ложных отключений нет; идентификация завершена до ' + fmt(v.tv * 1000, 0) + ' мс (id_done = 1)'; }, method: 'Режим A.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные r_id, ld_id, lq_id, psi_id, j_id, kp_d, kp_q, ki_i, kp_w, ki_w, id_done, iq_ref, theta_e, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var A = R.A, out = {};
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      if (!A || A.compileError) { LR8.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + (A ? A.compileError : 'нет результата')); }); return out; }
      var T = HZ / v.fsw, m = A.measures, tal1 = Math.round(v.tal1 * HZ), tv = Math.round(v.tv * HZ), ve = A.varsEnd || {}, tr = v.true;
      var enA = enableTick(A), trA = enA === null ? [] : trips(A, Math.max(enA, 10));
      function relv(name, truth, tol, scale, unit, d) { var x = ve[name]; if (typeof x !== 'number' || !isFinite(x)) return { ok: false, txt: name + ' не вычислена' }; var e = (x / truth - 1) * 100; return { ok: Math.abs(e) <= tol, txt: name + ' = ' + fmt(x * scale, d) + ' ' + unit + ' (' + (e >= 0 ? '+' : '') + fmt(e, 2) + ' %)' }; }
      function one(id, list) { var ok = list.every(function (q) { return q.ok; }); out[id] = res(ok, list.map(function (q) { return q.txt; }).join('; ')); }
      // И1
      var p1 = [];
      if (!m.fpwm) p1.push('счетчик ePWM1 не работает'); else if (Math.abs(m.fpwm - v.fsw) / v.fsw > 0.001) p1.push('частота ' + fmt(m.fpwm / 1000, 3) + ' кГц');
      [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA], ['C', m.dt3AB, m.dt3BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; if (mn < v.dtReq - 0.5 || mx > v.dtReq + 200.5) p1.push('мертвое время стойки ' + d[0] + ' ' + fmt(mn / 1000, 2) + '…' + fmt(mx / 1000, 2) + ' мкс'); });
      if (A.measures.shootN) p1.push('сквозной ток');
      var ea = angErr(A, tal1 + 2 * T, A.endTick);
      if (!ea) p1.push('нет переменной theta_e'); else if (Math.abs(ea.mean) > 1.5 || Math.abs(ea.max) > 4) p1.push('ошибка угла средняя ' + fmt(ea.mean, 2) + '°, наибольшая ' + fmt(ea.max, 2) + '°');
      out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : fmt(m.fpwm / 1000, 3) + ' кГц, ошибка угла ' + fmt(ea.mean, 2) + '/' + fmt(ea.max, 2) + '°');
      one('И2', [relv('r_id', tr.r, 3, 1, 'Ом', 3)]);
      one('И3', [relv('ld_id', tr.ld, 6, 1e3, 'мГн', 3), relv('lq_id', tr.lq, 6, 1e3, 'мГн', 3)]);
      one('И4', [relv('psi_id', tr.psi, 3, 1, 'Вб', 5)]);
      one('И5', [relv('j_id', tr.j, 5, 1e4, 'кг·см²', 3)]);
      one('И6', [relv('kp_d', tr.kpd, 7, 1, 'В/А', 2), relv('kp_q', tr.kpq, 7, 1, 'В/А', 2), relv('ki_i', tr.ki, 7, 1, 'В/(А·с)', 0)]);
      one('И7', [relv('kp_w', tr.kpw, 8, 1, 'А·с/рад', 4), relv('ki_w', tr.kiw, 8, 1, 'А/рад', 1)]);
      // И8
      var vt = Object.assign({}, v, { m: v.mt });
      if (trA.length) out['И8'] = bad('отключение защиты при t = ' + fmt(trA[0].t / HZ * 1e3, 2) + ' мс');
      else {
        var av = dqAvg(A, tv - 0.003 * HZ, A.endTick), sq = stepDQ(av, 'q', tv, A.endTick, 0, v.iqv), p8 = [], dmax = 0, dfin = 0, nd = 0;
        av.forEach(function (p) { if (p.t < tv) return; if (Math.abs(p.d) > Math.abs(dmax)) dmax = p.d; if (p.t > A.endTick - 0.002 * HZ) { dfin += p.d; nd++; } });
        dfin = nd ? dfin / nd : NaN; var tl = lr6TLim(vt, v.mt.lq, v.iqv, v.npsi, v.iqv);
        if (sq.t90 === null) p8.push('i_q не достигает 0,9 задания');
        else { if (sq.over > 10) p8.push('перерегулирование ' + fmt(sq.over, 1) + ' %'); if (sq.t90 > 1.001 * tl) p8.push('время нарастания ' + fmt(sq.t90 * 1e6, 0) + ' мкс (предел ' + fmt(tl * 1e6, 0) + ' мкс)'); if (Math.abs(sq.fin - v.iqv) > 0.03 * v.im) p8.push('ошибка i_q ' + fmt(sq.fin - v.iqv, 3) + ' А'); }
        if (Math.abs(dmax) > 0.12 * v.im) p8.push('отклонение i_d ' + fmt(dmax, 2) + ' А'); if (Math.abs(dfin) > 0.03 * v.im) p8.push('ошибка i_d ' + fmt(dfin, 3) + ' А');
        out['И8'] = res(p8.length === 0, p8.length ? p8.join('; ') : 'перерегулирование ' + fmt(sq.over, 1) + ' %, время нарастания ' + fmt(sq.t90 * 1e6, 0) + ' мкс (предел ' + fmt(tl * 1e6, 0) + '), отклонение i_d ' + fmt(dmax, 3) + ' А');
      }
      // И9
      var p9 = [], tlim = Math.round((v.tcal + 0.001) * HZ);
      if (enA === null) p9.push('выходы не включены'); else if (enA === 0) p9.push('выходы не отключены на время калибровки'); else if (enA > tlim) p9.push('выходы включены через ' + fmt(enA / HZ * 1e3, 1) + ' мс');
      if (trA.length) p9.push('отключение при t = ' + fmt(trA[0].t / HZ * 1e3, 2) + ' мс');
      var vd = A.logs.varX.id_done, tdone = null;
      if (vd) for (var k = 0; k < vd.length; k += 2) if (vd[k + 1] === 1) { tdone = vd[k]; break; }
      if (tdone === null) p9.push('идентификация не завершена'); else if (tdone > tv) p9.push('идентификация завершена при ' + fmt(tdone / HZ * 1e3, 1) + ' мс');
      out['И9'] = res(p9.length === 0, p9.length ? p9.join('; ') : 'выходы включены через ' + fmt(enA / HZ * 1e3, 1) + ' мс, идентификация завершена при ' + fmt(tdone / HZ * 1e3, 1) + ' мс');
      // И10
      var viol = [], x = A;
      if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
      if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
      if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
      if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
      if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
      if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
      ['r_id', 'ld_id', 'lq_id', 'psi_id', 'j_id', 'kp_d', 'kp_q', 'ki_i', 'kp_w', 'ki_w', 'id_done', 'theta_e'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
      if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
      if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };


  /* ------------------------------------------------------------ */
  /* ЛР9. Аппаратная токовая защита инвертора на CMPSS            */
  /* ------------------------------------------------------------ */
  var CMP_OF_CH = { 2: 1, 4: 2, 14: 4 };                       // вход ADCINA<ch> = CMPIN<k>P
  function lr9Variant(n) {
    var v = lr6Variant(n), r = rng(271828183 * n + 7);
    v.n = n;
    var pairs = [[2, 4], [4, 2], [2, 14], [14, 2], [4, 14], [14, 4]];
    var pr = pairs[(n + Math.floor(r() * 6)) % 6];
    v.ch = pr[0]; v.chb = pr[1];
    v.cmpA = CMP_OF_CH[v.ch]; v.cmpB = CMP_OF_CH[v.chb];
    v.muxA = 2 * (v.cmpA - 1); v.muxB = 2 * (v.cmpB - 1);
    v.bw = 1000;                                                    // полоса датчиков 1 МГц
    v.ihw = Math.min(r1(1.25 * v.imax), Math.floor(0.85 * 1.65 / v.sens * 10) / 10);   // уставка в пределах диапазона датчика с запасом на смещение и гистерезис
    v.tsp = stepIn(r, 0.20, 0.50, 0.05) * 1e-6;
    v.ttrip = v.tsp + stepIn(r, 0.6, 1.0, 0.1) * 1e-6;
    v.lk = stepIn(r, 15, 40, 5) * 1e-6;
    v.spAmp = Math.min(1.6, 1.35 * v.sens * v.ihw);
    v.nA = 1500; v.nB = 1500;
    v.iqA = r1(v.im); v.iqB = r1(0.5 * v.im); v.iqD = r1(1.9 * v.im);
    v.tf = v.t2 + 0.010;
    return v;
  }
  function pm9For(v, seed) {
    var s = pm6For(v, seed), r = rng(seed * 53 + 11);
    s.chans.forEach(function (c) { c.voff = (0.030 + 0.030 * r()) * (r() < 0.5 ? -1 : 1); });
    return s;
  }
  // коды ЦАП, соответствующие уставке, и уставки в амперах по кодам
  function lr9Thr(v, sn, ph, code) { var c = sn.chans[ph], v0 = 1.65 + c.voff; return (code * 3.3 / 4096 - v0) / (c.pol * c.sens * (1 + c.gerr)); }
  function lr9FiltDelay(snap, k, j) {
    var R = snap['Cmpss' + k + 'Regs']; if (!R) return null;
    var fc = R[j ? 'CTRIPLFILCTL' : 'CTRIPHFILCTL'], pr = (R[j ? 'CTRIPLFILCLKCTL' : 'CTRIPHFILCLKCTL'] & 0x3FF) + 1;
    return { w: ((fc >> 4) & 0x1F) + 1, th: ((fc >> 9) & 0x1F) + 1, ts: pr * 5e-9, sel: (R.COMPCTL >> (j ? 10 : 2)) & 3 };
  }
  // путь сигнала компаратора до однократного отключения модуля ePWM (по регистрам)
  function lr9Path(snap, k, j, mi) {
    var X = snap.EPwmXbarRegs, E = snap['EPwm' + mi + 'Regs'], trips = [4, 5, 7, 8, 9, 10, 11, 12], hit = [];
    trips.forEach(function (t, ti) {
      var en = X['TRIP' + t + 'MUXENABLE'] >>> 0, cfg = X['TRIP' + t + 'MUX0TO15CFG'] >>> 0, inv = (X.TRIPOUTINV >>> ti) & 1, mh = 2 * (k - 1);
      var ok = j === 0 ? (((en >>> mh) & 1) && ((cfg >>> (2 * mh)) & 3) <= 1) : ((((en >>> mh) & 1) && ((cfg >>> (2 * mh)) & 3) === 1) || (((en >>> (mh + 1)) & 1) && ((cfg >>> (2 * (mh + 1))) & 3) === 0));
      if (ok) hit.push({ t: t, inv: inv });
    });
    if (!hit.length) return { ok: false, why: 'X-BAR' };
    var ds = E.DCTRIPSEL, zd = E.TZDCSEL, ts = E.TZSEL;
    var dsel = [ds & 15, (ds >> 4) & 15, (ds >> 8) & 15, (ds >> 12) & 15];
    var evt = [zd & 7, (zd >> 6) & 7], ost = [(ts >> 14) & 1, (ts >> 15) & 1];
    for (var h = 0; h < hit.length; h++) {
      if (hit[h].inv) continue;
      for (var side = 0; side < 2; side++) {
        var hIn = dsel[2 * side] + 1, lIn = dsel[2 * side + 1] + 1, e = evt[side];
        var good = (hIn === hit[h].t && e === 2) || (lIn === hit[h].t && (e === 4 || (e === 5 && hIn !== hit[h].t)));
        if (good && ost[side]) return { ok: true, t: hit[h].t, dc: side ? 'DCBEVT1' : 'DCAEVT1' };
        if (good) return { ok: false, why: 'TZSEL', t: hit[h].t, dc: side ? 'DCBEVT1' : 'DCAEVT1' };
      }
    }
    return { ok: false, why: hit.every(function (q) { return q.inv; }) ? 'INV' : 'DC', t: hit[0].t };
  }
  var LR9 = {
    id: 'lr9', no: 9,
    title: 'Аппаратная токовая защита инвертора на компараторах CMPSS',
    variants: 30,
    variant: lr9Variant,
    interfaceVars: ['trip_src', 'trip_ph', 'iq_ref', 'theta_e'],
    sense: function (v) { return pm9For(v, 1); },
    trace: 'i_q',
    demo: function (v) { var p = LR9.runs(v)[1].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), loadEvents: p.loadEvents.slice(), Tsim: p.Tsim, encoder: p.encoder, traceExtra: ['i_b', 'trip_src', 'trip_ph'], scFault: p.scFault, spike: p.spike, sense: p.sense }; },
    describe: function (v) {
      var d = LR6.describe(v).filter(function (q) { return q[0].indexOf('Нагрузочная') < 0 && q[0].indexOf('Датчики') < 0; });
      return d.concat([
        ['Датчики тока фаз A и B', 'Холла, ' + fmt(v.sens * 1000, 0) + ' мВ/А, полоса 1 МГц, ADCINA' + v.ch + ' и ADCINA' + v.chb + ', ' + (v.pol > 0 ? 'напряжение растет при токе в двигатель' : 'напряжение убывает при токе в двигатель') + ', смещение нуля до ±60 мВ, окно выборки не менее ' + v.tSmin + ' нс'],
        ['Уставка аппаратной защиты I<sub>hw</sub>', fmt(v.ihw, 1) + ' А по модулю тока фазы'],
        ['Импульсные помехи', 'на выходах датчиков при переключениях стойки, длительность не более ' + fmt(v.tsp * 1e6, 2) + ' мкс'],
        ['Допустимое время отключения t<sub>откл</sub>', fmt(v.ttrip * 1e6, 2) + ' мкс от достижения током уставки до закрытия всех ключей'],
        ['Короткое замыкание', 'межфазное на выводах двигателя, индуктивность контура ' + fmt(v.lk * 1e6, 0) + ' мкГн']
      ]);
    },
    runs: function (v) {
      function base(seed, extra) { return Object.assign({ plant: 'pm3', Vdc: v.vdc, R: 1, L: 1, traceVar: 'i_q', traceExtra: ['i_a', 'i_b', 'theta_e', 'i_d', 'trip_src', 'trip_ph'], seed: seed, sense: pm9For(v, seed), encoder: enc6For(v, seed), motor: pm6Motor(v), spike: { amp: v.spAmp, dur: v.tsp - 0.03e-6, tail: 15e-9 } }, extra); }
      function dyn(nr) { return [{ t: v.ta, b: v.bstiff, wset: nr * Math.PI / 30, acc: nr * Math.PI / 30 / 0.02 }]; }
      return [
        { id: 'A', title: 'работа при ' + v.nA + ' об/мин, сигнал nFAULT', params: base(91000 + v.n, { Tsim: (v.t3 + 0.003) * 1e3, varEvents: [{ t: v.t2, name: 'iq_ref', value: v.iqA }], loadEvents: dyn(v.nA), faults: [{ pin: v.gpio, t0: v.t3, t1: v.t3 + 20e-6 }] }) },
        { id: 'B', title: 'КЗ между фазами B и C', params: base(92000 + v.n, { Tsim: (v.tf + 0.008) * 1e3, varEvents: [{ t: v.t2, name: 'iq_ref', value: v.iqB }], loadEvents: dyn(v.nB), scFault: { t: v.tf, a: 1, b: 2, sign: 1, lk: v.lk, rk: 0.05, mph: 1, ith: v.ihw, minInt: 1.5 * v.ihw * v.lk / v.vdc + v.ttrip + 0.5e-6 } }) },
        { id: 'C', title: 'КЗ между фазами A и C', params: base(93000 + v.n, { Tsim: (v.tf + 0.008) * 1e3, varEvents: [{ t: v.t2, name: 'iq_ref', value: v.iqB }], loadEvents: dyn(v.nB), scFault: { t: v.tf, a: 0, b: 2, sign: -1, lk: v.lk, rk: 0.05, mph: 0, ith: v.ihw, minInt: 1.5 * v.ihw * v.lk / v.vdc + v.ttrip + 0.5e-6 } }) },
        { id: 'D', title: 'перегрузка', params: base(94000 + v.n, { Tsim: (v.t2 + 0.020) * 1e3, varEvents: [{ t: v.t2, name: 'iq_ref', value: v.iqD }], loadEvents: dyn(300) }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'ШИМ и контуры тока', req: function (v) { return 'частота ' + fmt(v.fsw / 1000, 0) + ' кГц ± 0,1 %, мертвое время ' + fmt(v.dtReq / 1000, 1) + '…' + fmt((v.dtReq + 200) / 1000, 1) + ' мкс, нет сквозного тока; ошибка угла theta_e средняя не более 1,5°, наибольшая не более 4°; установившаяся ошибка i_q после скачка до ' + fmt(v.iqA, 1) + ' А не более 3 % I<sub>m</sub>'; }, method: 'Режимы A–D.' },
      { id: 'И2', name: 'Компараторы и путь сигнала отключения', req: function (v) { return 'включены CMPSS' + v.cmpA + ' (вход ADCINA' + v.ch + ') и CMPSS' + v.cmpB + ' (ADCINA' + v.chb + '), отрицательные входы от ЦАП; выходы верхнего и нижнего компараторов обоих модулей через ePWM X-BAR и подмодуль цифрового сравнения вызывают однократное отключение ePWM1, ePWM2, ePWM3'; }, method: 'Регистры в конце режима A.' },
      { id: 'И3', name: 'Уставки компараторов', req: function (v) { return 'ток срабатывания каждого из четырех компараторов ' + fmt(v.ihw, 1) + ' А ± 1,5 % по модулю с учетом смещения нуля датчика, верхний компаратор срабатывает выше верхней уставки, нижний - ниже нижней'; }, method: 'Коды DACHVALA, DACLVALA в конце режима A, действительные смещения и коэффициенты датчиков.' },
      { id: 'И4', name: 'Помехоустойчивость', req: function (v) { return 'выходы включены не позднее 1 мс после калибровки; ложных отключений нет при импульсных помехах длительностью до ' + fmt(v.tsp * 1e6, 2) + ' мкс и при токе ' + fmt(v.iqA, 1) + ' А'; }, method: 'Режим A до сигнала nFAULT, режимы B и C до замыкания.' },
      { id: 'И5', name: 'КЗ между фазами B и C', req: function (v) { return 'все ключи закрыты не позднее ' + fmt(v.ttrip * 1e6, 2) + ' мкс после достижения током фазы B уставки ' + fmt(v.ihw, 1) + ' А и остаются закрытыми; наибольший ток не более ' + fmt(v.ihw + v.vdc / v.lk * (v.ttrip + 0.05e-6), 1) + ' А'; }, method: 'Режим B: ток фазы B положительный.' },
      { id: 'И6', name: 'КЗ между фазами A и C', req: function (v) { return 'все ключи закрыты не позднее ' + fmt(v.ttrip * 1e6, 2) + ' мкс после достижения током фазы A уставки −' + fmt(v.ihw, 1) + ' А и остаются закрытыми; наибольший ток не более ' + fmt(v.ihw + v.vdc / v.lk * (v.ttrip + 0.05e-6), 1) + ' А'; }, method: 'Режим C: ток фазы A отрицательный.' },
      { id: 'И7', name: 'Программная защита от перегрузки', req: function (v) { return 'при токе ' + fmt(v.iqD, 1) + ' А все ключи закрыты программой не позднее двух периодов ШИМ после выборки тока выше I<sub>max</sub> = ' + fmt(v.imax, 1) + ' А, аппаратная защита не срабатывает'; }, method: 'Режим D: скачок iq_ref.' },
      { id: 'И8', name: 'Аварийный сигнал драйверов', req: function () { return 'все шесть ключей закрыты не позднее 0,2 мкс после появления сигнала nFAULT и остаются закрытыми'; }, method: 'Режим A: импульс низкого уровня 20 мкс на входе nFAULT.' },
      { id: 'И9', name: 'Определение причины отключения', req: function () { return 'trip_src = 1 при сигнале nFAULT, 2 при срабатывании компараторов, 3 при программной защите; trip_ph = 2 при КЗ B–C, 1 при КЗ A–C'; }, method: 'Значения переменных в конце режимов A–D.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные trip_src, trip_ph, iq_ref, theta_e, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var out = {}, runs = ['A', 'B', 'C', 'D'];
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      var dead = runs.filter(function (k) { return !R[k] || R[k].compileError; });
      if (dead.length) { var why = R[dead[0]] && R[dead[0]].compileError || 'нет результата'; LR9.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + why); }); return out; }
      var A = R.A, B = R.B, Cc = R.C, D = R.D, T = HZ / v.fsw, Im = v.im, t2 = Math.round(v.t2 * HZ), t3 = Math.round(v.t3 * HZ), tf = Math.round(v.tf * HZ), tal1 = Math.round(v.tal1 * HZ);
      var runP = LR9.runs(v), RR = { A: A, B: B, C: Cc, D: D };
      var en = {}, tr = {};
      runs.forEach(function (k) { en[k] = enableTick(RR[k]); tr[k] = en[k] === null ? [] : trips(RR[k], Math.max(en[k], 10)); });
      // И1
      var p1 = [], m = A.measures;
      if (!m.fpwm) p1.push('счетчик ePWM1 не работает'); else if (Math.abs(m.fpwm - v.fsw) / v.fsw > 0.001) p1.push('частота ' + fmt(m.fpwm / 1000, 3) + ' кГц');
      [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA], ['C', m.dt3AB, m.dt3BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; if (mn < v.dtReq - 0.5 || mx > v.dtReq + 200.5) p1.push('мертвое время стойки ' + d[0] + ' ' + fmt(mn / 1000, 2) + '…' + fmt(mx / 1000, 2) + ' мкс'); });
      if (runs.some(function (k) { return RR[k].measures.shootN; })) p1.push('сквозной ток');
      var ea = angErr(A, tal1 + 2 * T, t3);
      if (!ea) p1.push('нет переменной theta_e'); else if (Math.abs(ea.mean) > 1.5 || Math.abs(ea.max) > 4) p1.push('ошибка угла средняя ' + fmt(ea.mean, 2) + '°, наибольшая ' + fmt(ea.max, 2) + '°');
      var sqA = null;
      if (!tr.A.length || tr.A[0].t >= t3) { var avA = dqAvg(A, t2 - 0.002 * HZ, t3); sqA = stepDQ(avA, 'q', t2, t3, 0, v.iqA); if (!isFinite(sqA.fin) || Math.abs(sqA.fin - v.iqA) > 0.03 * Im) p1.push('ошибка i_q ' + (isFinite(sqA.fin) ? fmt(sqA.fin - v.iqA, 3) + ' А' : 'не определена')); }
      out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : fmt(m.fpwm / 1000, 3) + ' кГц, ошибка угла ' + fmt(ea.mean, 2) + '/' + fmt(ea.max, 2) + '°, ошибка i_q ' + fmt(sqA ? sqA.fin - v.iqA : 0, 3) + ' А');
      // И2
      var sn = A.snapEnd, p2 = [], used = [];
      if (!sn || !sn.Cmpss1Regs) p2.push('нет данных');
      else {
        [[v.cmpA, v.ch, 'A'], [v.cmpB, v.chb, 'B']].forEach(function (q) {
          var k = q[0], Rg = sn['Cmpss' + k + 'Regs'], ct = Rg.COMPCTL;
          if (!((sn.CpuSysRegs.PCLKCR14 >>> (k - 1)) & 1) || !((ct >> 15) & 1)) { p2.push('CMPSS' + k + ' (вход ADCINA' + q[1] + ', фаза ' + q[2] + ') не включен: COMPCTL.COMPDACE = 0'); return; }
          if (ct & 1) p2.push('CMPSS' + k + ': отрицательный вход верхнего компаратора - внешний вывод (COMPHSOURCE = 1)');
          if ((ct >> 8) & 1) p2.push('CMPSS' + k + ': отрицательный вход нижнего компаратора - внешний вывод (COMPLSOURCE = 1)');
          var miss = [];
          [0, 1].forEach(function (j) { [1, 2, 3].forEach(function (mi) { var pth = lr9Path(sn, k, j, mi); if (!pth.ok) miss.push({ j: j, mi: mi, why: pth.why, dc: pth.dc, t: pth.t }); }); });
          if (miss.length) {
            var w = miss[0], nm = 'CMPSS' + k + '.' + (w.j ? 'CTRIPL' : 'CTRIPH');
            var txt = w.why === 'X-BAR' ? nm + ' не подан ни на один выход ePWM X-BAR (TRIPxMUX0TO15CFG, TRIPxMUXENABLE)' : w.why === 'INV' ? nm + ': выход TRIP' + w.t + ' инвертирован (TRIPOUTINV)' : w.why === 'TZSEL' ? 'ePWM' + w.mi + ': событие ' + w.dc + ' от TRIP' + w.t + ' не выбрано источником однократного отключения (TZSEL)' : 'ePWM' + w.mi + ': TRIPIN' + w.t + ' (' + nm + ') не выбран в DCTRIPSEL или не задано событие в TZDCSEL';
            p2.push(txt + (miss.length > 1 ? ' (всего нарушений пути: ' + miss.length + ')' : ''));
          } else used.push('CMPSS' + k);
        });
        for (var ko = 1; ko <= 8; ko++) if (ko !== v.cmpA && ko !== v.cmpB && ((sn['Cmpss' + ko + 'Regs'].COMPCTL >> 15) & 1)) p2.push('включен CMPSS' + ko + ', к входам которого датчики не подключены');
      }
      out['И2'] = res(p2.length === 0, p2.length ? p2.join('; ') : used.join(', ') + ': верхний и нижний компараторы → X-BAR → DC → однократное отключение трех модулей ePWM');
      // И3
      var snA = runP[0].params.sense, p3 = [], thrTxt = [];
      if (sn && sn.Cmpss1Regs) {
        [[v.cmpA, 0, 'A'], [v.cmpB, 1, 'B']].forEach(function (q) {
          var Rg = sn['Cmpss' + q[0] + 'Regs'], ct = Rg.COMPCTL;
          if (!((ct >> 15) & 1)) return;
          var hinv = (ct >> 1) & 1, linv = (ct >> 9) & 1, iH = lr9Thr(v, snA, q[1], Rg.DACHVALA), iL = lr9Thr(v, snA, q[1], Rg.DACLVALA);
          // напряжение выше кода ЦАП - ток больше iH при pol > 0
          var upH = !hinv, upL = !linv, pol = snA.chans[q[1]].pol;
          var lim = [];
          [[iH, upH, 'верхний'], [iL, upL, 'нижний']].forEach(function (z) { var dirPos = (z[1] ? 1 : -1) * pol > 0; lim.push({ i: z[0], pos: dirPos, nm: z[2] }); });
          var pos = lim.filter(function (z) { return z.pos; }), neg = lim.filter(function (z) { return !z.pos; });
          if (pos.length !== 1 || neg.length !== 1) { p3.push('фаза ' + q[2] + ': оба компаратора срабатывают при токе одного знака (проверьте COMPHINV, COMPLINV)'); return; }
          var ip = pos[0].i, ineg = neg[0].i;
          thrTxt.push(q[2] + ': +' + fmt(ip, 2) + '/' + fmt(ineg, 2) + ' А');
          if (Math.abs(ip - v.ihw) > 0.015 * v.ihw) p3.push('фаза ' + q[2] + ': срабатывание при +' + fmt(ip, 2) + ' А (' + pos[0].nm + ' компаратор)');
          if (Math.abs(-ineg - v.ihw) > 0.015 * v.ihw) p3.push('фаза ' + q[2] + ': срабатывание при ' + fmt(ineg, 2) + ' А (' + neg[0].nm + ' компаратор)');
        });
      }
      if (!thrTxt.length && !p3.length) p3.push('компараторы не включены');
      out['И3'] = res(p3.length === 0, p3.length ? p3.join('; ') : 'ток срабатывания ' + thrTxt.join(', '));
      // И4
      var p4 = [], tlim = Math.round((v.tcal + 0.001) * HZ);
      [['A', t3], ['B', null], ['C', null]].forEach(function (q) {
        var x = RR[q[0]], e = en[q[0]], lim = q[1] !== null ? q[1] : (x.logs.sc && x.logs.sc.act !== null ? x.logs.sc.act : tf);
        if (e === null) { p4.push(q[0] + ': выходы не включены'); return; }
        if (e === 0) p4.push(q[0] + ': выходы не отключены на время калибровки'); else if (e > tlim) p4.push(q[0] + ': выходы включены через ' + fmt(e / HZ * 1e3, 1) + ' мс');
        var f = tr[q[0]].filter(function (z) { return z.t < lim; });
        if (f.length) p4.push(q[0] + ': ложное отключение при t = ' + fmt(f[0].t / HZ * 1e3, 3) + ' мс (' + f[0].src + ')');
      });
      var fd = [];
      if (sn && sn.Cmpss1Regs) [v.cmpA, v.cmpB].forEach(function (k) { [0, 1].forEach(function (j) { var q = lr9FiltDelay(sn, k, j); if (q && q.sel >= 2) fd.push(q.th * q.ts); else if (q && p4.length) p4.push('CMPSS' + k + '.' + (j ? 'CTRIPL' : 'CTRIPH') + ' без цифрового фильтра (CTRIP' + (j ? 'L' : 'H') + 'SEL = ' + q.sel + ')'); }); });
      out['И4'] = res(p4.length === 0, p4.length ? p4.join('; ') : 'ложных отключений нет' + (fd.length ? ', задержка фильтров ' + fmt(Math.min.apply(null, fd) * 1e6, 2) + '…' + fmt(Math.max.apply(null, fd) * 1e6, 2) + ' мкс' : ''));
      // И5, И6
      function scTest(x, key, name) {
        var sc = x.logs.sc, eT = en[key];
        if (eT === null) return bad('выходы не включены');
        if (!sc || sc.act === null) { var f0 = tr[key][0]; return bad('замыкание не наступило' + (f0 ? ': выходы отключены раньше, при t = ' + fmt(f0.t / HZ * 1e3, 3) + ' мс (' + f0.src + ')' : '')); }
        if (sc.cross === null) return bad('ток не достиг уставки: ключи закрыты при ' + fmt(sc.peak, 1) + ' А' + (sc.off !== null ? ' (' + srcOf(x, sc.act) + ')' : ''));
        var lim = v.ihw + v.vdc / v.lk * (v.ttrip + 0.05e-6), p = [];
        if (sc.off === null) p.push('ключи не закрыты, ток ' + fmt(sc.peak, 0) + ' А');
        else {
          var d = (sc.off - sc.cross) / HZ;
          if (d > v.ttrip) p.push('ключи закрыты через ' + fmt(d * 1e6, 2) + ' мкс (' + srcOf(x, sc.act) + ')');
          var after = 0; [0, 1, 2].forEach(function (mi) { var ed = x.logs.ed[mi]; after += edgesHigh(ed.A, sc.off, x.endTick).length + edgesHigh(ed.B, sc.off, x.endTick).length; });
          if (after) p.push('ключи снова включены после отключения');
        }
        if (sc.peak > lim) p.push('наибольший ток ' + fmt(sc.peak, 1) + ' А');
        return res(p.length === 0, p.length ? p.join('; ') : 'ключи закрыты через ' + fmt((sc.off - sc.cross) / HZ * 1e6, 2) + ' мкс после достижения уставки, наибольший ток ' + fmt(sc.peak, 1) + ' А');
      }
      function srcOf(x, from) { var q = trips(x, from - 1)[0]; return q ? 'отключение ' + q.src : 'нет отключения'; }
      out['И5'] = scTest(B, 'B');
      out['И6'] = scTest(Cc, 'C');
      // И7
      var Lg = D.logs, trD = tr.D.filter(function (q) { return q.t >= t2; }), tex = null, z = Lg.prdT;
      for (var p7 = 0; p7 < z.length && tex === null; p7++) {
        if (z[p7] < t2) continue;
        var q7 = Math.floor(z[p7] / Lg.dec); if (q7 >= Lg.iS.length) break;
        var s1 = Lg.iS[q7], s2 = Lg.iS2[q7], mx7 = Math.max(Math.abs(s1), Math.abs(s2), Math.abs(s1 + s2));
        if (mx7 > v.imax) tex = z[p7];
      }
      if (!trD.length) out['И7'] = bad('отключения нет');
      else if (trD[0].src.indexOf('DC') === 0) out['И7'] = bad('сработала аппаратная защита (' + trD[0].src + '), программная защита не успела');
      else if (tex === null || tex > trD[0].t) {
        // отключение по измеренному току чуть ниже уставки (погрешность датчиков): допускается от 0,95 I_max
        var pk7 = 0; for (var p8 = 0; p8 < z.length && z[p8] <= trD[0].t; p8++) { if (z[p8] < t2) continue; var q8 = Math.floor(z[p8] / Lg.dec); if (q8 >= Lg.iS.length) break; pk7 = Math.max(pk7, Math.abs(Lg.iS[q8]), Math.abs(Lg.iS2[q8]), Math.abs(Lg.iS[q8] + Lg.iS2[q8])); }
        if (pk7 >= 0.95 * v.imax) out['И7'] = res(true, 'отключение программой (' + trD[0].src + ') при токе ' + fmt(pk7, 2) + ' А, в пределах погрешности датчиков');
        else out['И7'] = bad('отключение при токе ' + fmt(pk7, 2) + ' А, ниже уставки I<sub>max</sub> (' + trD[0].src + ')');
      }
      else {
        var eds = [0, 1, 2].map(function (i) { return Lg.ed[i]; }), offT = null;
        for (var tt = tex; tt <= D.endTick; tt += 10) { if (eds.every(function (e) { return levelAt(e.A, tt) !== 1 && levelAt(e.B, tt) !== 1 && edgesHigh(e.A, tt, D.endTick).length === 0 && edgesHigh(e.B, tt, D.endTick).length === 0; })) { offT = tt; break; } }
        if (offT === null) out['И7'] = bad('ключи не закрыты');
        else { var d7 = (offT - tex) / HZ; out['И7'] = res(d7 <= 2 / v.fsw + 1e-6, 'все ключи закрыты через ' + fmt(Math.max(0, d7) * 1e6, 0) + ' мкс после превышения уставки (' + trD[0].src + ')'); }
      }
      // И8
      var bads = [], worst = 0;
      if (en.A === null || en.A > t3) out['И8'] = bad('выходы не включены до появления сигнала');
      else if (tr.A.length && tr.A[0].t < t3) out['И8'] = bad('выходы отключены до появления сигнала');
      else {
        [0, 1, 2].forEach(function (mi) {
          var ed = A.logs.ed[mi], offAll = 0, ok = true;
          [ed.A, ed.B].forEach(function (e) { var off = levelAt(e, t3) === 1 ? null : t3; for (var k = 0; k < e.length; k += 2) { if (e[k] < t3) continue; if (e[k + 1] === 1) ok = false; else if (off === null) off = e[k]; } if (off === null) ok = false; else offAll = Math.max(offAll, off - t3); });
          if (!ok) bads.push('стойка ' + 'ABC'[mi] + ' не отключена'); else if (offAll > 20) bads.push('стойка ' + 'ABC'[mi] + ' отключена через ' + fmt(offAll * 10 / 1000, 2) + ' мкс');
          worst = Math.max(worst, offAll);
        });
        out['И8'] = res(bads.length === 0, bads.length ? bads.join('; ') : 'все ключи закрыты через ' + fmt(worst * 10 / 1000, 2) + ' мкс и остаются закрытыми');
      }
      // И9
      var p9 = [], want = { A: [1, null], B: [2, 2], C: [2, 1], D: [3, null] }, got = [];
      runs.forEach(function (k) {
        var ve = RR[k].varsEnd || {}, s = ve.trip_src, ph = ve.trip_ph;
        if (typeof s !== 'number') { if (p9.indexOf('нет переменной trip_src') < 0) p9.push('нет переменной trip_src'); return; }
        got.push(k + ': ' + s + (want[k][1] !== null ? '/' + ph : ''));
        if (s !== want[k][0]) p9.push(k + ': trip_src = ' + s + ' вместо ' + want[k][0]);
        if (want[k][1] !== null) { if (typeof ph !== 'number') { if (p9.indexOf('нет переменной trip_ph') < 0) p9.push('нет переменной trip_ph'); } else if (ph !== want[k][1]) p9.push(k + ': trip_ph = ' + ph + ' вместо ' + want[k][1]); }
      });
      out['И9'] = res(p9.length === 0, p9.length ? p9.join('; ') : 'trip_src/trip_ph ' + got.join(', '));
      // И10
      var viol = [];
      runs.forEach(function (k) {
        var x = RR[k];
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        ['trip_src', 'trip_ph', 'iq_ref', 'theta_e'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };


  /* ------------------------------------------------------------ */
  /* ЛР10. Комплексные приемочные испытания сервопривода          */
  /* ------------------------------------------------------------ */
  function lr10Variant(n) {
    var v = lr9Variant(n), v7 = lr7Variant(n), v8 = lr8Variant(n);
    ['nw', 'tw', 'tmuw', 'km', 'ilim', 'vmaxn', 'vmax', 'amax', 'dist', 'mload', 'mover'].forEach(function (k) { v[k] = v7[k]; });
    ['kR', 'kLd', 'kLq', 'kPsi', 'mt', 'tL', 'tJend', 'tpsi', 'npsi', 'true'].forEach(function (k) { v[k] = v8[k]; });
    // наброс и перегрузка - доли номинального момента действительного двигателя (k_M по действительному Psi_f)
    v.mload = +(v.mload * v.kPsi).toFixed(3); v.mover = +(v.mover * v.kPsi).toFixed(3);
    v.jest = sig2(v.jsum);
    v.tdec = v.tpsi + 0.06; v.tfree = v.tdec + 0.045; v.t1 = v.tfree + 0.01;
    v.TA = trajT(v.dist * 2 * Math.PI, v.vmax, v.amax);
    v.tA2 = v.t1 + v.TA + 0.03; v.tA3 = v.tA2 + 0.03; v.tA4 = v.tA3 + 0.02; v.tA5 = v.tA4 + 0.015; v.tAe = v.tA5 + 0.07;
    v.t1b = v.tal1 + 0.01; v.tfB = v.t1b + 0.5 * v.TA; v.tBe = v.tfB + 0.008;
    return v;
  }
  function pm10Motor(v) { var m = v.mt; return { rs: m.rs, ld: m.ld, lq: m.lq, psi: m.psi, p: m.p, j: v.jsum, b: v.bsoft, wset: 0, tc: v.tc, tload: 0, th0: v.th0 }; }
  var LR10 = {
    id: 'lr10', no: 10,
    title: 'Комплексные приемочные испытания сервопривода',
    variants: 30,
    variant: lr10Variant,
    interfaceVars: ['pos_ref', 'pos_meas', 'trip_src', 'id_done', 'theta_e'],
    sense: function (v) { return pm9For(v, 1); },
    trace: 'pos_meas',
    demo: function (v) { var p = LR10.runs(v)[0].params; return { plant: p.plant, motor: Object.assign({}, p.motor), varEvents: p.varEvents.slice(), loadEvents: p.loadEvents.slice(), Tsim: p.Tsim, encoder: p.encoder, traceExtra: ['n_meas', 'iq_ref', 'id_done'], spike: p.spike, sense: p.sense }; },
    describe: function (v) {
      var m = v.m;
      var d = LR9.describe(v).filter(function (q) { return q[0].indexOf('Параметры') < 0 && q[0].indexOf('Короткое') < 0; });
      return d.concat([
        ['Паспортные параметры', 'R<sub>s</sub> = ' + fmt(m.rs, 2) + ' Ом, L<sub>d</sub> = ' + fmt(m.ld * 1000, 1) + ' мГн, L<sub>q</sub> = ' + fmt(m.lq * 1000, 1) + ' мГн, Ψ<sub>f</sub> = ' + fmt(m.psi, 4) + ' Вб; оценка J<sub>Σ</sub> = ' + String(v.jest * 1e4).replace('.', ',') + ' кг·см²; действительные значения отличаются'],
        ['Контур скорости, задатчик', 'N<sub>ω</sub> = ' + v.nw + ', I<sub>огр</sub> = ' + fmt(v.ilim, 1) + ' А, ' + v.vmaxn + ' об/мин, ' + v.amax + ' рад/с²'],
        ['Режим A', 'идентификация (нагрузочная машина вращает вал при ' + fmt(v.tpsi * 1000, 0) + ' мс и останавливает его при ' + fmt(v.tdec * 1000, 0) + ' мс), перемещение на ' + v.dist + ' об при ' + fmt(v.t1 * 1000, 0) + ' мс, наброс ' + fmt(v.mload, 3) + ' Н·м, перегрузка ' + fmt(v.mover, 3) + ' Н·м'],
        ['Режимы B и C', 'пуск без идентификации (ident_en = 0), перемещение; КЗ фаз B и C (L<sub>к</sub> = ' + fmt(v.lk * 1e6, 0) + ' мкГн) или сигнал nFAULT во время движения']
      ]);
    },
    runs: function (v) {
      function base(seed, extra) { return Object.assign({ plant: 'pm3', Vdc: v.vdc, R: 1, L: 1, traceVar: 'pos_meas', traceExtra: ['i_a', 'i_b', 'theta_e', 'iq_ref', 'n_meas', 'id_done', 'trip_src', 'trip_ph'], seed: seed, sense: pm9For(v, seed), encoder: enc6For(v, seed), motor: pm10Motor(v), spike: { amp: v.spAmp, dur: v.tsp - 0.03e-6, tail: 15e-9 } }, extra); }
      var w15 = v.npsi * Math.PI / 30;
      var evA = [{ t: v.tal1 + 0.001, b: 0 }, { t: v.tpsi, b: v.bstiff, wset: w15, acc: w15 / 0.02 }, { t: v.tdec, wset: 0, acc: w15 / 0.02 }, { t: v.tfree, b: 0 }, { t: v.tA2, tload: v.mload }, { t: v.tA3, tload: 0 }, { t: v.tA4, tload: v.mover }, { t: v.tA5, tload: 0 }];
      var evB = [{ t: v.tal1 + 0.002, b: 0 }];
      return [
        { id: 'A', title: 'идентификация, перемещение, наброс момента, перегрузка', params: base(101000 + v.n, { Tsim: v.tAe * 1e3, varEvents: [{ t: v.t1, name: 'pos_ref', value: v.dist }], loadEvents: evA }) },
        { id: 'B', title: 'КЗ фаз B и C при движении', params: base(102000 + v.n, { Tsim: v.tBe * 1e3, overrides: { ident_en: 0 }, varEvents: [{ t: v.t1b, name: 'pos_ref', value: v.dist }], loadEvents: evB, scFault: { t: v.tfB, a: 1, b: 2, sign: 1, lk: v.lk, rk: 0.05, mph: 1, ith: v.ihw, minInt: 1.5 * v.ihw * v.lk / v.vdc + v.ttrip + 0.5e-6 } }) },
        { id: 'C', title: 'сигнал nFAULT при движении', params: base(103000 + v.n, { Tsim: (v.tfB + 0.003) * 1e3, overrides: { ident_en: 0 }, varEvents: [{ t: v.t1b, name: 'pos_ref', value: v.dist }], loadEvents: evB, faults: [{ pin: v.gpio, t0: v.tfB, t1: v.tfB + 20e-6 }] }) }
      ];
    },
    tests: [
      { id: 'И1', name: 'Силовая часть и включение', req: function (v) { return 'частота ШИМ ' + fmt(v.fsw / 1000, 0) + ' кГц ± 0,1 %, мертвое время ' + fmt(v.dtReq / 1000, 1) + '…' + fmt((v.dtReq + 200) / 1000, 1) + ' мкс, нет сквозного тока; ошибка угла theta_e средняя не более 1,5°, наибольшая не более 4°; выходы включены не позднее 1 мс после калибровки; в режиме A отключений нет'; }, method: 'Режимы A–C.' },
      { id: 'И2', name: 'Идентификация R, L', req: function (v) { return 'r_id = ' + fmt(v.true.r, 3) + ' Ом ± 3 %, ld_id = ' + fmt(v.true.ld * 1e3, 3) + ' мГн ± 10 %, lq_id = ' + fmt(v.true.lq * 1e3, 3) + ' мГн ± 10 %'; }, method: 'Режим A, значения переменных в конце.' },
      { id: 'И3', name: 'Идентификация Ψ<sub>f</sub>, J и настройка контура скорости', req: function (v) { return 'psi_id = ' + fmt(v.true.psi, 5) + ' Вб ± 3 %, j_id = ' + fmt(v.true.j * 1e4, 3) + ' кг·см² ± 5 %, kp_w = ' + fmt(v.true.kpw, 4) + ', ki_w = ' + fmt(v.true.kiw, 1) + ' ± 8 %; id_done = 1 до команды перемещения'; }, method: 'Режим A.' },
      { id: 'И4', name: 'Перемещение и позиционирование', req: function (v) { return 'перемещение на ' + v.dist + ' об: частота вращения не более ' + fmt(lr7NMax(v), 0) + ' об/мин, вход в зону ±10 импульсов не позднее ' + fmt((v.TA + 0.015) * 1000, 0) + ' мс, перерегулирование не более 20 импульсов, установившаяся ошибка не более 3 импульсов, pos_meas = ' + v.dist + ' об ± 2 импульса'; }, method: 'Режим A, положение относительно момента команды.' },
      { id: 'И5', name: 'Ошибка слежения', req: function (v) { return 'отклонение от трапецеидального графика не более ' + fmt(lr7Follow(v) / (2 * Math.PI) * v.Z, 0) + ' импульсов'; }, method: 'Режим A, движение; график сравнивается с положением при наилучшем сдвиге графика в пределах ±T<sub>ω</sub>: задатчик обновляется раз в T<sub>ω</sub> и запускается в первом вызове контура скорости после команды.' },
      { id: 'И6', name: 'Наброс момента нагрузки', req: function (v) { return 'наибольшее отклонение не более ' + fmt(lr7Dev(v) / (2 * Math.PI) * v.Z, 0) + ' импульсов, через 25 мс ошибка не более 3 импульсов'; }, method: 'Режим A: 0,5 M<sub>ном</sub> в течение 30 мс.' },
      { id: 'И7', name: 'Перегрузка', req: function (v) { return 'ток i_q не более 1,05 I<sub>огр</sub>, без отключения; возврат с перерегулированием не более ' + fmt(lr7Over(v) / (2 * Math.PI) * v.Z, 0) + ' импульсов, ошибка в конце режима не более 3 импульсов'; }, method: 'Режим A: 2 M<sub>ном</sub> в течение 15 мс.' },
      { id: 'И8', name: 'Короткое замыкание при движении', req: function (v) { return 'ложных отключений до замыкания нет; все ключи закрыты не позднее ' + fmt(v.ttrip * 1e6, 2) + ' мкс после достижения током фазы B уставки ' + fmt(v.ihw, 1) + ' А, наибольший ток не более ' + fmt(v.ihw + v.vdc / v.lk * (v.ttrip + 0.05e-6), 1) + ' А; trip_src = 2, trip_ph = 2'; }, method: 'Режим B.' },
      { id: 'И9', name: 'Сигнал nFAULT при движении', req: function () { return 'все шесть ключей закрыты не позднее 0,2 мкс после появления сигнала и остаются закрытыми; trip_src = 1'; }, method: 'Режим C.' },
      { id: 'И10', name: 'Правила программирования', req: function () { return 'нет нарушений'; }, method: 'Защищенные регистры только между EALLOW и EDIS, сброс ADCINT1 и подтверждение группы 1 PIE, переменные ident_en, pos_ref, pos_meas, n_meas, iq_ref, theta_e, r_id, ld_id, lq_id, psi_id, j_id, kp_w, ki_w, id_done, trip_src, trip_ph, отсутствие ошибок выполнения.' }
    ],
    evaluate: function (v, R) {
      var out = {}, runs = ['A', 'B', 'C'];
      function res(ok, meas) { return { ok: ok, meas: meas }; }
      function bad(meas) { return { ok: false, meas: meas }; }
      var dead = runs.filter(function (k) { return !R[k] || R[k].compileError; });
      if (dead.length) { var why = R[dead[0]] && R[dead[0]].compileError || 'нет результата'; LR10.tests.forEach(function (t) { out[t.id] = bad('испытание не проведено: ' + why); }); return out; }
      var A = R.A, B = R.B, Cc = R.C, RR = { A: A, B: B, C: Cc }, T = HZ / v.fsw, Z = v.Z, cnt = Z / (2 * Math.PI), tr = v.true;
      var tal1 = Math.round(v.tal1 * HZ), t1 = Math.round(v.t1 * HZ), tfB = Math.round(v.tfB * HZ);
      var en = {}, trs = {};
      runs.forEach(function (k) { en[k] = enableTick(RR[k]); trs[k] = en[k] === null ? [] : trips(RR[k], Math.max(en[k], 10)); });
      // И1
      var p1 = [], m = A.measures, tlim = Math.round((v.tcal + 0.001) * HZ);
      if (!m.fpwm) p1.push('счетчик ePWM1 не работает'); else if (Math.abs(m.fpwm - v.fsw) / v.fsw > 0.001) p1.push('частота ' + fmt(m.fpwm / 1000, 3) + ' кГц');
      [['A', m.dtAB, m.dtBA], ['B', m.dt2AB, m.dt2BA], ['C', m.dt3AB, m.dt3BA]].forEach(function (d) { if (!d[1] || !d[2]) { p1.push('стойка ' + d[0] + ': нет переключений'); return; } var mn = Math.min(d[1].min, d[2].min) * 1e9, mx = Math.max(d[1].max, d[2].max) * 1e9; if (mn < v.dtReq - 0.5 || mx > v.dtReq + 200.5) p1.push('мертвое время стойки ' + d[0] + ' ' + fmt(mn / 1000, 2) + '…' + fmt(mx / 1000, 2) + ' мкс'); });
      if (runs.some(function (k) { return RR[k].measures.shootN; })) p1.push('сквозной ток');
      var ea = angErr(A, tal1 + 2 * T, A.endTick);
      if (!ea) p1.push('нет переменной theta_e'); else if (Math.abs(ea.mean) > 1.5 || Math.abs(ea.max) > 4) p1.push('ошибка угла средняя ' + fmt(ea.mean, 2) + '°, наибольшая ' + fmt(ea.max, 2) + '°');
      runs.forEach(function (k) { var e = en[k]; if (e === null) p1.push(k + ': выходы не включены'); else if (e === 0) p1.push(k + ': выходы не отключены на время калибровки'); else if (e > tlim) p1.push(k + ': выходы включены через ' + fmt(e / HZ * 1e3, 1) + ' мс'); });
      if (trs.A.length) p1.push('A: отключение при t = ' + fmt(trs.A[0].t / HZ * 1e3, 3) + ' мс (' + trs.A[0].src + ')');
      out['И1'] = res(p1.length === 0, p1.length ? p1.join('; ') : fmt(m.fpwm / 1000, 3) + ' кГц, ошибка угла ' + fmt(ea.mean, 2) + '/' + fmt(ea.max, 2) + '°, отключений нет');
      // И2, И3
      var ve = A.varsEnd || {};
      function relv(name, truth, tol, scale, unit, d) { var x = ve[name]; if (typeof x !== 'number' || !isFinite(x)) return { ok: false, txt: name + ' не вычислена' }; var e = (x / truth - 1) * 100; return { ok: Math.abs(e) <= tol, txt: name + ' = ' + fmt(x * scale, d) + ' ' + unit + ' (' + (e >= 0 ? '+' : '') + fmt(e, 2) + ' %)' }; }
      function one(id, list) { var ok = list.every(function (q) { return q.ok; }); out[id] = res(ok, list.map(function (q) { return q.txt; }).join('; ')); }
      one('И2', [relv('r_id', tr.r, 3, 1, 'Ом', 3), relv('ld_id', tr.ld, 10, 1e3, 'мГн', 3), relv('lq_id', tr.lq, 10, 1e3, 'мГн', 3)]);
      var vd = A.logs.varX.id_done, tdone = null;
      if (vd) for (var k = 0; k < vd.length; k += 2) if (vd[k + 1] === 1) { tdone = vd[k]; break; }
      var l3 = [relv('psi_id', tr.psi, 3, 1, 'Вб', 5), relv('j_id', tr.j, 5, 1e4, 'кг·см²', 3), relv('kp_w', tr.kpw, 8, 1, 'А·с/рад', 4), relv('ki_w', tr.kiw, 8, 1, 'А/рад', 1)];
      l3.push(tdone === null ? { ok: false, txt: 'идентификация не завершена' } : tdone > t1 ? { ok: false, txt: 'идентификация завершена при ' + fmt(tdone / HZ * 1e3, 1) + ' мс, после команды' } : { ok: true, txt: 'завершена при ' + fmt(tdone / HZ * 1e3, 1) + ' мс' });
      one('И3', l3);
      // движение режима A: положение относительно момента команды
      var L = A.logs, k0 = Math.min(L.iN - 1, Math.floor(t1 / L.dec)), dRad = v.dist * 2 * Math.PI;
      var tA2 = Math.round(v.tA2 * HZ), tA3 = Math.round(v.tA3 * HZ), tA4 = Math.round(v.tA4 * HZ), tA5 = Math.round(v.tA5 * HZ);
      function pos(k) { return L.pmS[k] - L.pmS[k0]; }
      function finErr(a, b, target) { var mx = 0; for (var k = Math.ceil(a / L.dec); k < Math.floor(b / L.dec) && k < L.iN; k += 5) mx = Math.max(mx, Math.abs(pos(k) - target) * cnt); return mx; }
      var nmax = 0, tin = null, fol = 0, overA = 0;
      for (var k = Math.ceil(t1 / L.dec); k < Math.floor(tA2 / L.dec) && k < L.iN; k += 5) {
        var t = k * L.dec, x = pos(k);
        nmax = Math.max(nmax, Math.abs(L.wS[k]) * 30 / Math.PI);
        if (tin === null && Math.abs(x - dRad) * cnt <= 10) tin = t;
        if (tin !== null && Math.abs(x - dRad) * cnt > 10) tin = null;
        // ошибка слежения считается после цикла: с учетом сдвига начала графика на долю периода контура скорости
        overA = Math.max(overA, (x - dRad) * cnt);
      }
      var p4 = [], fA = finErr(tA2 - 0.005 * HZ, tA2, dRad);
      if (nmax > lr7NMax(v)) p4.push('частота вращения до ' + fmt(nmax, 0) + ' об/мин');
      if (tin === null) p4.push('положение не входит в зону ±10 импульсов'); else if ((tin - t1) / HZ > v.TA + 0.015) p4.push('вход в зону через ' + fmt((tin - t1) / HZ * 1000, 1) + ' мс');
      if (overA > 20) p4.push('перерегулирование ' + fmt(overA, 0) + ' импульсов');
      if (fA > 3) p4.push('ошибка ' + fmt(fA, 1) + ' импульсов');
      var vpm = L.varT, pm = null; if (vpm) for (var k = 0; k < vpm.length; k += 2) { if (vpm[k] <= tA2) pm = vpm[k + 1]; }
      if (pm === null) p4.push('нет переменной pos_meas'); else if (Math.abs(pm - v.dist) * Z > 2.5) p4.push('pos_meas = ' + fmt(pm, 4) + ' об');
      out['И4'] = res(p4.length === 0, p4.length ? p4.join('; ') : 'n до ' + fmt(nmax, 0) + ' об/мин, вход в зону через ' + fmt((tin - t1) / HZ * 1000, 1) + ' мс (график ' + fmt(v.TA * 1000, 1) + ' мс), перерегулирование ' + fmt(Math.max(0, overA), 1) + ' имп., ошибка ' + fmt(fA, 1) + ' имп.');
      // задатчик обновляется раз в T_w и запускается в первом вызове контура скорости после команды: положение
      // задатчика смещено относительно непрерывного графика от t1 на величину до T_w в обе стороны, и это смещение
      // зависит от фазы делителя N_w в момент перехода к работе. Ошибка слежения - по наилучшему сдвигу в пределах +-T_w.
      fol = Infinity;
      for (var dq = -10; dq <= 10; dq++) {
        var sh = dq / 10 * v.tw * HZ, fq = 0;
        for (var k = Math.ceil(t1 / L.dec); k < Math.floor(tA2 / L.dec) && k < L.iN; k += 5) {
          var t = k * L.dec; if (t > t1 + sh + v.TA * HZ) break;
          fq = Math.max(fq, Math.abs(pos(k) - trajPos(dRad, v.vmax, v.amax, Math.max(0, t - t1 - sh) / HZ)));
        }
        fol = Math.min(fol, fq);
      }
      out['И5'] = res(fol <= lr7Follow(v), 'наибольшее отклонение ' + fmt(fol * cnt, 0) + ' импульсов (' + fmt(fol / (2 * Math.PI) * 360, 2) + '°)');
      var dev = 0; for (var k = Math.ceil(tA2 / L.dec); k < Math.floor(tA3 / L.dec) && k < L.iN; k += 5) dev = Math.max(dev, Math.abs(pos(k) - dRad));
      var f6 = finErr(tA3 - 0.005 * HZ, tA3, dRad);
      out['И6'] = res(dev <= lr7Dev(v) && f6 <= 3, 'наибольшее отклонение ' + fmt(dev * cnt, 0) + ' импульсов, через 25 мс ' + fmt(f6, 1) + ' имп.');
      var iqm = 0, ov7 = 0, p7 = [];
      dqAvg(A, tA4 - 0.002 * HZ, A.endTick).forEach(function (p) { iqm = Math.max(iqm, Math.abs(p.q)); });
      for (var k = Math.ceil(tA5 / L.dec); k < L.iN; k += 5) ov7 = Math.max(ov7, pos(k) - dRad);
      var f7 = finErr(A.endTick - 0.003 * HZ, A.endTick, dRad);
      if (trs.A.length) p7.push('отключение защиты');
      if (iqm > 1.05 * v.ilim) p7.push('ток i_q до ' + fmt(iqm, 2) + ' А');
      if (ov7 > lr7Over(v)) p7.push('перерегулирование ' + fmt(ov7 * cnt, 0) + ' импульсов');
      if (f7 > 3) p7.push('ошибка в конце ' + fmt(f7, 1) + ' имп.');
      out['И7'] = res(p7.length === 0, p7.length ? p7.join('; ') : 'ток i_q до ' + fmt(iqm, 2) + ' А, перерегулирование ' + fmt(Math.max(0, ov7) * cnt, 0) + ' имп., ошибка в конце ' + fmt(f7, 1) + ' имп.');
      // И8
      var sc = B.logs.sc, p8 = [];
      if (en.B === null) p8.push('выходы не включены');
      else {
        var lim = sc && sc.act !== null ? sc.act : B.endTick, f0 = trs.B.filter(function (q) { return q.t < lim; });
        if (f0.length) p8.push('отключение до замыкания при t = ' + fmt(f0[0].t / HZ * 1e3, 3) + ' мс (' + f0[0].src + ')');
        else if (!sc || sc.act === null) p8.push('замыкание не наступило');
        else if (sc.cross === null) p8.push('ток не достиг уставки');
        else if (sc.off === null) p8.push('ключи не закрыты, ток ' + fmt(sc.peak, 0) + ' А');
        else {
          var d8 = (sc.off - sc.cross) / HZ, pk = v.ihw + v.vdc / v.lk * (v.ttrip + 0.05e-6);
          if (d8 > v.ttrip) p8.push('ключи закрыты через ' + fmt(d8 * 1e6, 2) + ' мкс');
          if (sc.peak > pk) p8.push('наибольший ток ' + fmt(sc.peak, 1) + ' А');
          var after = 0; [0, 1, 2].forEach(function (mi) { var ed = B.logs.ed[mi]; after += edgesHigh(ed.A, sc.off, B.endTick).length + edgesHigh(ed.B, sc.off, B.endTick).length; });
          if (after) p8.push('ключи снова включены');
        }
        var vb = B.varsEnd || {};
        if (vb.trip_src !== 2) p8.push('trip_src = ' + vb.trip_src);
        if (vb.trip_ph !== 2) p8.push('trip_ph = ' + vb.trip_ph);
      }
      out['И8'] = res(p8.length === 0, p8.length ? p8.join('; ') : 'ключи закрыты через ' + fmt((sc.off - sc.cross) / HZ * 1e6, 2) + ' мкс, наибольший ток ' + fmt(sc.peak, 1) + ' А, trip_src = 2, trip_ph = 2');
      // И9
      var bads = [], worst = 0;
      if (en.C === null || en.C > tfB) bads.push('выходы не включены до появления сигнала');
      else if (trs.C.length && trs.C[0].t < tfB) bads.push('отключение до появления сигнала (' + trs.C[0].src + ')');
      else {
        [0, 1, 2].forEach(function (mi) {
          var ed = Cc.logs.ed[mi], offAll = 0, ok = true;
          [ed.A, ed.B].forEach(function (e) { var off = levelAt(e, tfB) === 1 ? null : tfB; for (var k = 0; k < e.length; k += 2) { if (e[k] < tfB) continue; if (e[k + 1] === 1) ok = false; else if (off === null) off = e[k]; } if (off === null) ok = false; else offAll = Math.max(offAll, off - tfB); });
          if (!ok) bads.push('стойка ' + 'ABC'[mi] + ' не отключена'); else if (offAll > 20) bads.push('стойка ' + 'ABC'[mi] + ' отключена через ' + fmt(offAll * 10 / 1000, 2) + ' мкс');
          worst = Math.max(worst, offAll);
        });
        if ((Cc.varsEnd || {}).trip_src !== 1) bads.push('trip_src = ' + (Cc.varsEnd || {}).trip_src);
      }
      out['И9'] = res(bads.length === 0, bads.length ? bads.join('; ') : 'все ключи закрыты через ' + fmt(worst * 10 / 1000, 2) + ' мкс, trip_src = 1');
      // И10
      var viol = [];
      runs.forEach(function (k) {
        var x = RR[k];
        if (x.ignored) viol.push('невыполненные записи в регистры: ' + x.ignored);
        if (x.warnKeys.indexOf('eallowisr') >= 0 || x.warnKeys.indexOf('eallowmain') >= 0) viol.push('нет EDIS после EALLOW');
        if (x.warnKeys.indexOf('adcclr') >= 0) viol.push('не сбрасывается ADCINT1');
        if (x.warnKeys.indexOf('adcovf') >= 0) viol.push('переполнение ADCINT1');
        if (x.warnKeys.indexOf('ack1') >= 0) viol.push('нет подтверждения PIEACK_GROUP1');
        if (x.missingVars.length) viol.push('нет переменных: ' + x.missingVars.join(', '));
        ['ident_en', 'pos_ref', 'pos_meas', 'n_meas', 'iq_ref', 'theta_e', 'r_id', 'ld_id', 'lq_id', 'psi_id', 'j_id', 'kp_w', 'ki_w', 'id_done', 'trip_src', 'trip_ph'].forEach(function (nm) { if (!x.varsEnd || typeof x.varsEnd[nm] !== 'number') viol.push('нет переменной ' + nm); });
        if (x.halted) viol.push('выполнение остановлено: ' + (x.haltReason || 'ошибка'));
        if (!x.reachedBg) viol.push('main() не дошла до фонового цикла');
      });
      viol = viol.filter(function (s, i) { return viol.indexOf(s) === i; });
      out['И10'] = res(viol.length === 0, viol.length ? viol.join('; ') : 'нарушений нет');
      return out;
    }
  };

  return { lr5Variant: lr5Variant, im5For: im5For, im5Motor: im5Motor, imSteady: imSteady, lr4Variant: lr4Variant, lr3TLim: lr3TLim, lr4Internals: { nAvgPeriods: nAvgPeriods, nTrueAvg: nTrueAvg, measErr: measErr, seriesIn: seriesIn, enableTick: enableTick, trips: trips, iAvgPeriods: iAvgPeriods }, HZ: HZ, LABS: { lr1: LR1, lr2: LR2, lr3: LR3, lr4: LR4, lr5: LR5, lr6: LR6, lr7: LR7, lr8: LR8, lr9: LR9, lr10: LR10 }, list: [LR1, LR2, LR3, LR4, LR5, LR6, LR7, LR8, LR9, LR10], lr7Internals: { trajPos: trajPos, trajT: trajT }, lr6Internals: { dqAvg: dqAvg, angErr: angErr }, lr9Internals: { pm9For: pm9For, lr9Thr: lr9Thr, lr9Path: lr9Path }, protocolHtml: protocolHtml, fmt: fmt, fundamental: fundamental };
})();
if (typeof module !== 'undefined') module.exports = C2KLAB;
