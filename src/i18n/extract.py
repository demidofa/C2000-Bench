# Извлечение видимых пользователю русских строк из JS/HTML/C
import re, json, sys
CYR = re.compile(r'[А-Яа-яЁё]')

def js_tokens(s, base=0):
    """yield (start,end,text) of string literal contents (template literals split on ${...}); skips comments"""
    i, n = 0, len(s)
    out = []
    while i < n:
        c = s[i]
        if c == '/' and i+1 < n and s[i+1] == '/':
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and i+1 < n and s[i+1] == '*':
            j = s.find('*/', i+2); i = n if j < 0 else j+2; continue
        if c in '"\'':
            j = i+1
            while j < n and s[j] != c:
                if s[j] == '\\': j += 1
                if s[j] == '\n': break
                j += 1
            out.append((base+i+1, base+j, s[i+1:j])); i = j+1; continue
        if c == '`':
            j = i+1; seg = j
            while j < n and s[j] != '`':
                if s[j] == '\\': j += 2; continue
                if s[j] == '$' and j+1 < n and s[j+1] == '{':
                    out.append((base+seg, base+j, s[seg:j]))
                    depth = 1; k = j+2
                    while k < n and depth:
                        if s[k] == '{': depth += 1
                        elif s[k] == '}': depth -= 1
                        elif s[k] in '"\'`':
                            q = s[k]; k += 1
                            while k < n and s[k] != q:
                                if s[k] == '\\': k += 1
                                k += 1
                        k += 1
                    # inner expression may contain strings: recurse
                    out += js_tokens(s[j+2:k-1], base+j+2)
                    j = k; seg = j; continue
                j += 1
            out.append((base+seg, base+j, s[seg:j])); i = j+1; continue
        i += 1
    return out

def html_tokens(s):
    out = []
    # scripts and styles
    pos = 0
    for m in re.finditer(r'<script[^>]*>(.*?)</script>', s, re.S):
        out += html_text(s[pos:m.start()], pos)
        out += js_tokens(m.group(1), m.start(1))
        pos = m.end()
    out += html_text(s[pos:], pos)
    return out

def html_text(s, base):
    out = []
    s2 = re.sub(r'<style[^>]*>.*?</style>', lambda m: ' '*len(m.group(0)), s, flags=re.S)
    s2 = re.sub(r'<!--.*?-->', lambda m: ' '*len(m.group(0)), s2, flags=re.S)
    for m in re.finditer(r'>([^<]+)<', s2):
        if m.group(1) != s[m.start(1):m.end(1)]: continue
        out.append((base+m.start(1), base+m.end(1), s[m.start(1):m.end(1)]))
    for m in re.finditer(r'(?:title|placeholder|aria-label|alt|value)="([^"]*)"', s2):
        out.append((base+m.start(1), base+m.end(1), s[m.start(1):m.end(1)]))
    return out

def c_tokens(s):
    out = []
    for m in re.finditer(r'//[^\n]*', s): out.append((m.start(), m.end(), m.group(0)))
    for m in re.finditer(r'/\*.*?\*/', s, re.S): out.append((m.start(), m.end(), m.group(0)))
    for m in re.finditer(r'"([^"\n]*)"', s): out.append((m.start(1), m.end(1), m.group(1)))
    return out

def tokens(path, s):
    if path.endswith('.html'): t = html_tokens(s)
    elif path.endswith('.c'): t = c_tokens(s)
    else: t = js_tokens(s)
    return [x for x in t if CYR.search(x[2])]

if __name__ == '__main__':
    allstr = {}
    for p in sys.argv[1:]:
        s = open(p, encoding='utf-8').read()
        for a, b, txt in tokens(p, s):
            allstr.setdefault(txt, []).append(p.split('/')[-1])
    json.dump({k: sorted(set(v)) for k, v in allstr.items()}, open('strings.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(len(allstr), sum(len(k) for k in allstr))
