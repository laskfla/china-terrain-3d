"""Embed build/terrain.json and build/history.json into src/template.html and write index.html."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = (ROOT / 'build' / 'terrain.json').read_text(encoding='utf8')
template = (ROOT / 'src' / 'template.html').read_text(encoding='utf8')
history = (ROOT / 'build' / 'history.json').read_text(encoding='utf8')
assert '__TERRAIN__' in template and '__HISTORY__' in template
assert '</' not in history, 'history.json would end its <script> element early'
page = template.replace('__TERRAIN__', data).replace('__HISTORY__', history)
# The template is written as a page fragment (no <html>/<head>); wrap it so it is a complete document.
head, body = page.split('<div id="stage"', 1)
html = ('<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0;font-size:14px}[hidden]{display:none!important}</style>\n'
        + head + '</head>\n<body>\n<div id="stage"' + body + '\n</body>\n</html>\n')
out = ROOT / (sys.argv[1] if len(sys.argv) > 1 else 'index.html')
out.write_text(html, encoding='utf8')
print(f'wrote {out} ({len(html) / 1e6:.2f} MB)')
