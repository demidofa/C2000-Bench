/* Локальная версия: файлы, презентация, связь с оболочкой */
(function () {
  'use strict';
  // оболочка завершает работу, когда окна перестают присылать отметки
  function beat() { try { fetch('/api/beat', { cache: 'no-store' }).catch(function () {}); } catch (e) {} }
  beat(); setInterval(beat, 2000);

  var ta = document.getElementById('code');
  if (!ta) return;
  var acts = document.querySelector('.head .acts');
  var fileLbl = document.querySelector('.head .file');
  var handle = null, fileName = 'app.c', dirty = false, savedText = ta.value;
  var NAME_KEY = 'c2k-local-filename';
  try { var n0 = localStorage.getItem(NAME_KEY); if (n0) fileName = n0; } catch (e) {}

  function showName() {
    fileLbl.textContent = fileName + (dirty ? '  (изменен)' : '');
    document.title = fileName + ' - Стенд C2000';
  }
  function setDirty(v) { dirty = v; showName(); }
  ta.addEventListener('input', function () { setDirty(ta.value !== savedText); });
  showName();

  function mk(label, title, fn) {
    var b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.textContent = label; b.title = title;
    b.addEventListener('click', fn);
    return b;
  }
  var types = [{ description: 'Исходный текст на C', accept: { 'text/x-c': ['.c', '.h', '.txt'] } }];

  function loadText(text, name) {
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    fileName = name; savedText = text; setDirty(false);
    try { localStorage.setItem(NAME_KEY, fileName); } catch (e) {}
    document.getElementById('run').click();
  }
  async function openFile() {
    if (window.showOpenFilePicker) {
      try {
        var hs = await window.showOpenFilePicker({ types: types, multiple: false });
        handle = hs[0];
        var f = await handle.getFile();
        loadText(await f.text(), f.name);
      } catch (e) { if (e && e.name !== 'AbortError') alertMsg('Не удалось открыть файл: ' + e.message); }
      return;
    }
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.c,.h,.txt';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      f.text().then(function (t) { handle = null; loadText(t, f.name); });
    };
    inp.click();
  }
  async function writeTo(h) {
    var w = await h.createWritable();
    await w.write(ta.value.replace(/\r?\n/g, '\r\n'));
    await w.close();
    savedText = ta.value; setDirty(false);
  }
  async function saveAs() {
    if (window.showSaveFilePicker) {
      try {
        var h = await window.showSaveFilePicker({ suggestedName: fileName, types: types });
        await writeTo(h);
        handle = h; fileName = h.name; showName();
        try { localStorage.setItem(NAME_KEY, fileName); } catch (e) {}
      } catch (e) { if (e && e.name !== 'AbortError') alertMsg('Не удалось сохранить файл: ' + e.message); }
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ta.value.replace(/\r?\n/g, '\r\n')], { type: 'text/plain' }));
    a.download = fileName; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    savedText = ta.value; setDirty(false);
  }
  async function save() {
    if (handle) { try { await writeTo(handle); return; } catch (e) { handle = null; } }
    await saveAs();
  }
  function alertMsg(t) {
    var c = document.getElementById('console');
    var d = document.createElement('div');
    d.className = 'msg err';
    d.innerHTML = '<div class="lvl">Ошибка</div><div></div>';
    d.lastChild.textContent = t;
    c.prepend(d);
  }

  // сохранение произвольного текста (протокол испытаний)
  window.C2KLocal = {
    saveText: async function (name, text, desc, ext, mime) {
      if (window.showSaveFilePicker) {
        try {
          var acc = {}; acc[mime] = [ext];
          var h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: acc }] });
          var w = await h.createWritable(); await w.write(text); await w.close();
        } catch (e) { if (e && e.name !== 'AbortError') alertMsg('Не удалось сохранить файл: ' + e.message); }
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: mime }));
      a.download = name; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }
  };

  acts.prepend(mk('Сохранить как', 'Сохранить в новый файл', saveAs));
  acts.prepend(mk('Сохранить', 'Ctrl+S', save));
  acts.prepend(mk('Открыть', 'Ctrl+O', openFile));
  // замена текста кнопками «Исходный текст», «Заготовка», опытами: новый безымянный файл
  if (window.C2KUI) {
    window.C2KUI.onReplaced = function (name) {
      handle = null; fileName = name || 'app.c'; savedText = ta.value; setDirty(false);
      try { localStorage.setItem(NAME_KEY, fileName); } catch (e) {}
    };
    window.C2KUI.isSaved = function () { return !dirty && !!handle; };
    window.C2KUI.saveCode = async function () { await save(); return !dirty; };
  }

  var controls = document.querySelector('.controls');
  var pres = mk('Презентация', 'Слайды работы, выбранной на вкладке «Приемка», в отдельном окне', function () {
    var sel = document.getElementById('accLab'), lab = sel && /^lr\d+$/.test(sel.value) ? sel.value : 'lr1';
    window.open('slides_' + lab + '.html', 'c2k-slides-' + lab, 'popup,width=1280,height=760');
  });
  controls.insertBefore(pres, document.getElementById('run'));

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = e.key.toLowerCase();
    if (k === 's' || k === 'ы') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
    if (k === 'o' || k === 'щ') { e.preventDefault(); openFile(); }
  });
  window.addEventListener('beforeunload', function (e) {
    if (dirty && handle) { e.preventDefault(); e.returnValue = ''; }
  });
})();
