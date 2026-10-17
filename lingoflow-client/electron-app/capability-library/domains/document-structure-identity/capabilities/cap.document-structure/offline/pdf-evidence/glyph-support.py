"""Read original PDFs to bound review frames without neighboring prose glyphs."""
import json
import re
import argparse
from pathlib import Path
from statistics import median
import pdfplumber

parser = argparse.ArgumentParser(description='Derive glyph support from the current PDF candidate')
parser.add_argument('--candidate', type=Path, required=True)
parser.add_argument('--source-inventory', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
candidate = json.loads(args.candidate.read_text(encoding='utf-8'))
inventory = json.loads(args.source_inventory.read_text(encoding='utf-8'))

def bbox(items):
    x, y = min(c['x0'] for c in items), min(c['top'] for c in items)
    return dict(x=x, y=y, width=max(c['x1'] for c in items)-x, height=max(c['bottom'] for c in items)-y)

def inside(c, b):
    x, y = (c['x0']+c['x1'])/2, (c['top']+c['bottom'])/2
    return b['x']-.2 <= x <= b['x']+b['width']+.2 and b['y']-.2 <= y <= b['y']+b['height']+.2

matched, unresolved = [], []
for meta in inventory['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for number, pdfpage in enumerate(pdf.pages, 1):
            key = f"{meta['paper']}:{number}"
            page = candidate['pages'][key]
            lines = {l['sourceLineId']:l for l in inventory['pages'][key]['sourceLines']}
            owners = {id:o for o in page['objects'] + page.get('referenceObjectRefs', []) for id in o['sourceLineIds']}
            words, chars = pdfpage.extract_words(), pdfpage.chars
            protected, supports = [], {}
            for id, line in lines.items():
                owner = owners.get(id)
                if not owner or owner['type'] in ('formula', 'figure', 'table'):
                    continue
                terms = re.findall(r'[A-Za-z]{2,}', line['text'])
                if not terms:
                    continue
                b = line['bbox']
                hits = [w for w in words if w['x0'] >= b['x']-2 and w['x1'] <= b['x']+b['width']+2
                        and abs(w['bottom'] - b['y']) <= max(10, b['height']*.65)
                        and re.sub('[^A-Za-z]', '', w['text']) in terms]
                rows = []
                for word in sorted(hits, key=lambda w:w['top']):
                    row = next((r for r in rows if abs(median(w['top'] for w in r)-word['top']) < 3), None)
                    if row is None:
                        rows.append([word])
                    else:
                        row.append(word)
                if not rows:
                    continue
                row = max(rows, key=lambda r:(len(r), -abs(median(w['bottom'] for w in r)-b['y'])))
                if len(row) < min(2, len(terms)):
                    continue
                top, bottom = min(w['top'] for w in row), max(w['bottom'] for w in row)
                rowchars = [c for c in chars if c['x0'] >= b['x']-1 and c['x1'] <= b['x']+b['width']+1
                            and top-.8 <= (c['top']+c['bottom'])/2 <= bottom+.8]
                if not rowchars:
                    continue
                support = bbox(rowchars)
                protected.append((owner['objectId'], support))
                supports[id] = support
                components=[]
                for char in sorted(rowchars,key=lambda c:c['x0']):
                    if not components or char['x0']-max(c['x1'] for c in components[-1]) > max(30,support['height']*3):
                        components.append([char])
                    else:
                        components[-1].append(char)
                matched.append(dict(page=key, sourceLineId=id, type=owner['type'], visualBox=support,
                                    visualFragments=[bbox(c) for c in components],
                                    evidence='original_pdf_prose_row_word_alignment'))
            formula_lines = {id:lines[id] for id,o in owners.items() if o['type']=='formula'}
            for id, line in formula_lines.items():
                b, own = line['bbox'], owners[id]['objectId']
                lower, upper = b['y']-b['height']*1.2, b['y']+b['height']*1.1
                for other_id, other in formula_lines.items():
                    if other_id == id or owners[other_id]['objectId'] == own:
                        continue
                    q = other['bbox']
                    horizontal = max(0, min(b['x']+b['width'], q['x']+q['width'])-max(b['x'],q['x']))
                    if horizontal < min(b['width'],q['width'])*.4 or abs(q['y']-b['y'])>32:
                        continue
                    boundary = (b['y']+q['y'])/2
                    if q['y']>b['y']:
                        upper=min(upper,boundary)
                    else:
                        lower=max(lower,boundary)
                hits = [c for c in chars if c['x0']>=b['x']-1.5 and c['x1']<=b['x']+b['width']+1.5
                        and lower <= (c['top']+c['bottom'])/2 <= upper
                        and not any(other!=own and inside(c,support) for other,support in protected)]
                if not hits or len(hits)>max(18,len(line['text'])*2.6):
                    unresolved.append(dict(page=key,sourceLineId=id,reason='ambiguous_character_support'))
                    continue
                visual=bbox(hits)
                if visual['height']>max(56,b['height']*3.2):
                    unresolved.append(dict(page=key,sourceLineId=id,reason='character_support_too_tall'))
                    continue
                matched.append(dict(page=key,sourceLineId=id,type='formula',visualBox=visual,
                                    evidence='original_pdf_math_glyphs_excluding_confirmed_prose_rows'))
result=dict(schemaVersion='OfflineReviewGlyphSupport/v1',authority='none',membershipChanged=False,
            summary=dict(matched=len(matched),unresolved=len(unresolved)),matched=matched,unresolved=unresolved)
args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result['summary']))
