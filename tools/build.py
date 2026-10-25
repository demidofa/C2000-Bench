#!/usr/bin/env python3
"""Build C2000 Bench.

    python3 tools/build.py            # both editions: build/ru and build/en
    python3 tools/build.py en         # English edition only

Each edition gets a web folder (index.html + fonts) that can be opened from any
static web server, and, if the Go toolchain is installed, a Windows executable
that embeds the web folder. If Node.js and tools/node_modules are present
(npm install inside tools/), the icon and version information are added.
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = os.path.join(ROOT, 'src', 'simulator')
WIN = os.path.join(ROOT, 'src', 'windows')
I18N = os.path.join(ROOT, 'src', 'i18n')
OUT = os.path.join(ROOT, 'build')
sys.path.insert(0, I18N)
from extract import tokens  # noqa: E402


def rd(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def sources():
    """Names of all files that make up the program, mapped to their paths."""
    m = {n: os.path.join(SIM, n) for n in ('page.html', 'core.js', 'lab.js', 'accept_ui.js', 'template.c')}
    for n in range(1, 11):
        m[f'lr{n}_student.c'] = os.path.join(SIM, 'templates', f'lr{n}_student.c')
    m['local.js'] = os.path.join(WIN, 'local.js')
    m['main.go'] = os.path.join(WIN, 'main.go')
    m['msg_windows.go'] = os.path.join(WIN, 'msg_windows.go')
    return m


def translate(name, text, table):
    toks = tokens(name, text)
    toks = [t for t in toks if not any(o[0] <= t[0] and t[1] <= o[1] and (o[0], o[1]) != (t[0], t[1]) for o in toks)]
    seen, missing = set(), []
    for a, b, s in sorted(toks, key=lambda t: t[0], reverse=True):
        if (a, b) in seen:
            continue
        seen.add((a, b))
        if s in table:
            text = text[:a] + table[s] + text[b:]
        else:
            missing.append(s)
    return text, missing


def english(files):
    table = json.loads(rd(os.path.join(I18N, 'translations_en.json')))
    table.update(json.loads(rd(os.path.join(I18N, 'manual_fix.json'))))
    fixes = json.loads(rd(os.path.join(I18N, 'code_fix.json')))
    out = {}
    for name, text in files.items():
        text, missing = translate(name, text, table)
        if missing:
            print(f'  {name}: {len(missing)} strings without translation, e.g. {missing[0][:60]!r}')
        for old, new in fixes.get(name, []):
            text = text.replace(old, new)
        out[name] = text
    lab = out['lab.js']
    for old in (".toFixed(d).replace('.', ',')", "String(v.j).replace('.', ',')", "String(v.jsum).replace('.', ',')",
                "String(v.jsum * 1e4).replace('.', ',')", "String(v.jest * 1e4).replace('.', ',')"):
        lab = lab.replace(old, old.replace(".replace('.', ',')", ''))
    out['lab.js'] = lab
    # slides exist in Russian only: no Presentation button in the English edition
    out['local.js'] = re.sub(r"\n  var controls = document\.querySelector\('\.controls'\);\n  var pres = mk\(.*?"
                             r"controls\.insertBefore\(pres, document\.getElementById\('run'\)\);\n", "\n",
                             out['local.js'], flags=re.S)
    g = out['main.go']
    g = g.replace('fixedPort = "47820"', 'fixedPort = "47830"').replace('appID     = "stend-c2000"', 'appID     = "c2000-bench"')
    g = g.replace('"StendC2000", "browser"', '"C2000Bench", "browser"')
    g = re.sub(r'\n\tfor _, a := range os\.Args\[1:\] \{\n\t\tif a == "--slides" \|\| a == "/slides" \{\n'
               r'\t\t\tpage = "slides\.html"\n\t\t\}\n\t\}', '', g)
    out['main.go'] = g
    return out


def page(files, lang):
    p = files['page.html']
    p = re.sub(r'<link rel="preconnect"[^>]*>\n', '', p)
    p = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', '<link rel="stylesheet" href="fonts.css">', p)
    p = p.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
    p = p.replace('/*__CORE__*/', files['core.js']).replace("/*__TEMPLATE__*/''", json.dumps(files['template.c'], ensure_ascii=False))
    p = p.replace('/*__LAB__*/', files['lab.js']).replace('/*__ACCUI__*/', files['accept_ui.js'])
    for n in range(1, 11):
        p = p.replace(f"/*__STUDENT_LR{n}__*/''", json.dumps(files[f'lr{n}_student.c'], ensure_ascii=False))
    assert '/*__' not in p
    p = p.replace('.app { padding-left', 'body { margin: 0; }\n.app { padding-left', 1)
    return (f'<!doctype html>\n<html lang="{lang}">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            + p + '\n<script>\n' + files['local.js'] + '\n</script>\n</html>\n')


def edition(lang):
    files = {n: rd(p) for n, p in sources().items()}
    if lang == 'en':
        files = english(files)
    d = os.path.join(OUT, lang)
    if os.path.exists(d):
        shutil.rmtree(d)
    app = os.path.join(d, 'app')
    web = os.path.join(app, 'web')
    os.makedirs(web)
    wr(os.path.join(web, 'index.html'), page(files, lang))
    shutil.copytree(os.path.join(WIN, 'fonts'), os.path.join(web, 'fonts'))
    shutil.copy(os.path.join(WIN, 'fonts.css'), web)
    if lang == 'ru':
        for f in os.listdir(os.path.join(WIN, 'web-ru')):
            s = os.path.join(WIN, 'web-ru', f)
            (shutil.copytree if os.path.isdir(s) else shutil.copy)(s, os.path.join(web, f))
    wr(os.path.join(app, 'main.go'), files['main.go'])
    wr(os.path.join(app, 'msg_windows.go'), files['msg_windows.go'])
    shutil.copy(os.path.join(WIN, 'msg_other.go'), app)
    wr(os.path.join(app, 'go.mod'), 'module c2000bench\n\ngo 1.22\n' if lang == 'en' else rd(os.path.join(WIN, 'go.mod')))
    wr(os.path.join(d, 'app.c'), files['template.c'].replace('\r\n', '\n').replace('\n', '\r\n'))
    exe = os.path.join(d, 'C2000 Bench.exe' if lang == 'en' else 'Стенд C2000.exe')
    go = shutil.which('go')
    if not go:
        print(f'[{lang}] web edition in {web}; Go not found, executable not built')
        return
    env = dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0')
    subprocess.run([go, 'build', '-ldflags', '-H windowsgui -s -w', '-o', exe, '.'], cwd=app, env=env, check=True)
    tools = os.path.join(ROOT, 'tools')
    if shutil.which('node') and os.path.isdir(os.path.join(tools, 'node_modules')):
        script = 'patch_en.mjs' if lang == 'en' else 'patch.mjs'
        subprocess.run(['node', script, exe, os.path.join(WIN, 'icon.ico')], cwd=tools, check=True)
    print(f'[{lang}] {exe}')


if __name__ == '__main__':
    for lang in (sys.argv[1:] or ['ru', 'en']):
        edition(lang)
