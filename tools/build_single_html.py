from pathlib import Path
import base64
import hashlib
import json
import re
import argparse

repository = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Build a standalone offline HTML containing all game assets.')
parser.add_argument('--source', type=Path, default=repository)
parser.add_argument('--output', type=Path, default=repository / 'build' / 'yi-mian-yi-mian-offline.html')
args = parser.parse_args()
root = args.source.resolve()
target = args.output.resolve()
target.parent.mkdir(parents=True, exist_ok=True)
assets = {}
for path in sorted((root / 'art').glob('*.png')):
    assets['art/' + path.name] = base64.b64encode(path.read_bytes()).decode('ascii')

def js_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')

data = json.loads((root / 'data.json').read_text())
art = json.loads((root / 'art.json').read_text())
app = (root / 'app.js').read_text()
race = (root / 'race.js').read_text()
bootstrap = app.index('Promise.all([fetch(')
app = app[:bootstrap]

# Every remaining HTML image is the logo. Convert single-quoted HTML
# templates before inserting the runtime Blob URL into all logo templates.
race, changed = re.subn(
    r"'([^'\n]*src=\"art/ui-logo\.png\"[^'\n]*)'",
    lambda match: '`' + match.group(1) + '`',
    race,
)
assert changed == 2
for name, script in [('app', app), ('race', race)]:
    script = script.replace('src="art/ui-logo.png"', 'src="${OFFLINE_URLS[\'art/ui-logo.png\']}"')
    assert 'fetch(' not in script
    if name == 'app':
        app = script
    else:
        race = script

css = (root / 'play.css').read_text().replace("url('art/ui-garden.png')", 'var(--offline-garden)')
html = (root / 'index.html').read_text()
html = re.sub(r'<link rel="stylesheet"[^>]*>', '<style>\n' + css + '\n</style>', html)
html = re.sub(r'<script defer src="[^"]+"></script>', '', html)
html = html.replace('<img src="art/ui-logo.png"', '<img id="offline-brand-logo"')
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob: data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">')

setup = '''
'use strict';
// All artwork and questions are contained in this document. No network access.
const OFFLINE_IMAGE_BYTES=JSON.parse(document.querySelector('#offline-image-data').textContent);
document.querySelector('#offline-image-data').remove();
const OFFLINE_URLS=Object.create(null);
for(const [name,encoded] of Object.entries(OFFLINE_IMAGE_BYTES)){
 const binary=atob(encoded),bytes=new Uint8Array(binary.length);
 for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
 OFFLINE_URLS[name]=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
 delete OFFLINE_IMAGE_BYTES[name];
}
const OFFLINE_DATA=__DATA__;
const OFFLINE_ART=__ART__;
for(const sheet of Object.values(OFFLINE_ART))sheet.file=OFFLINE_URLS[sheet.file];
document.documentElement.style.setProperty('--offline-garden',`url("${OFFLINE_URLS['art/ui-garden.png']}")`);
document.querySelector('#offline-brand-logo').src=OFFLINE_URLS['art/ui-logo.png'];
'''.replace('__DATA__', js_json(data)).replace('__ART__', js_json(art))
script = setup + '\n' + app + '\n' + race + '\nDATA=OFFLINE_DATA;ART=OFFLINE_ART;raceArtReady=true;home();\n'
script = re.sub('</script', r'<\\/script', script, flags=re.I)
html = html.replace('</body>', '<script type="application/json" id="offline-image-data">' + js_json(assets) + '</script><script id="offline-game">\n' + script + '\n</script></body>')
assert not re.search(r'<script[^>]+src=|<link[^>]+stylesheet|<img[^>]+src="art/', html)
assert 'fetch(' not in script and 'url(\'art/' not in css
assert len(assets) == 29 and len(data['actions']) == 18
target.write_text(html)
report = {
    'file': str(target.resolve()),
    'size_bytes': target.stat().st_size,
    'embedded_images': len(assets),
    'actions': len(data['actions']),
    'network_required': False,
    'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
}
target.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(f'Created standalone HTML: {target.name}; {target.stat().st_size / 1024**2:.1f} MB; {len(assets)} embedded images; no external resources.')
