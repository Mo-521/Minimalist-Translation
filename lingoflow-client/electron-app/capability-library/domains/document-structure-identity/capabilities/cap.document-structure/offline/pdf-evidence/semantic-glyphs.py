"""Offline original-PDF evidence; frozen lines and human frames are not rewritten."""
import argparse
import json
import re
from pathlib import Path
import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument('--source-inventory', type=Path, required=True)
parser.add_argument('--candidate', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = json.loads(args.source_inventory.read_text(encoding='utf-8'))
candidate = json.loads(args.candidate.read_text(encoding='utf-8'))

def box(chars):
    if not chars:
        return None
    return dict(x=min(c['x0'] for c in chars), y=min(c['top'] for c in chars),
                width=max(c['x1'] for c in chars)-min(c['x0'] for c in chars),
                height=max(c['bottom'] for c in chars)-min(c['top'] for c in chars))

pages = {}
for meta in source['papers']:
    paper = meta['paper']
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for key, sp in source['pages'].items():
            if int(key.split(':')[0]) != paper:
                continue
            chars = [c for c in pdf.pages[int(key.split(':')[1])-1].chars if c['text'].strip()]
            supports, mixed = {}, []
            page = candidate['pages'][key]
            relevant = {i for o in page['objects'] if o['type'] in ('body', 'formula') for i in o['sourceLineIds']}
            relevant.update(p['sourceLineId'] for p in page['pendingMembership'])
            for line in sp['sourceLines']:
                if line['sourceLineId'] not in relevant:
                    continue
                b = line['bbox']
                tolerance = max(8, min(14, b['height']*.55))
                selected = [c for c in chars if b['x']-1 <= (c['x0']+c['x1'])/2 <= b['x']+b['width']+1
                            and ((b['y']-b['height']-1 <= (c['top']+c['bottom'])/2 <= b['y']+1)
                                 if line.get('sourceSpanKind') else abs((c['top']+c['bottom'])/2-b['y']) <= tolerance)]
                g = box(selected)
                supports[line['sourceLineId']] = {'box': g, 'glyphCount': len(selected),
                    'horizontalCoverage': g['width']/max(1, b['width']) if g else 0}
                # Text partition and separated glyph clusters must independently agree.
                match = re.fullmatch(r'([A-Za-z]+(?:\s+[A-Za-z]+){0,5})([_\s]*[0-9]+(?:\s+[0-9]+)*|_[A-Za-z])', line['text'])
                if not match or not selected:
                    continue
                clusters = []
                for c in sorted(selected, key=lambda c:c['x0']):
                    if not clusters or c['x0']-max(q['x1'] for q in clusters[-1]) > max(12, c['size']*2):
                        clusters.append([c])
                    else:
                        clusters[-1].append(c)
                if len(clusters) < 2:
                    continue
                first, rest = clusters[0], [c for cluster in clusters[1:] for c in cluster]
                # PDF fonts may encode mathematical symbols as cid strings; matching
                # the natural-language prefix is nevertheless exact and inspectable.
                visible = ''.join(c['text'] for c in sorted(first, key=lambda c:c['x0']))
                if re.sub(r'\s+', '', visible) != re.sub(r'\s+', '', match[1]):
                    continue
                expected = re.sub(r'[^A-Za-z0-9]', '', match[2])
                last = [c for c in rest if c['text'] in expected]
                suffix = ''.join(c['text'] for c in sorted(last, key=lambda c:c['x0']))
                if re.sub(r'[^A-Za-z0-9]', '', suffix) != re.sub(r'[^A-Za-z0-9]', '', match[2]):
                    continue
                mixed.append({'sourceLineId': line['sourceLineId'], 'splitAt':len(match[1]),
                              'prefixBox':box(first), 'suffixBox':box(last), 'prefix':match[1],
                              'suffix':match[2], 'glyphText': [visible,suffix]})
            pages[key] = {'lines': supports, 'mixedSpans':mixed}
    print(json.dumps({'paper':paper,'inspectedPages':sum(k.startswith(str(paper)+':') for k in pages)}), flush=True)
args.output.write_text(json.dumps({'authority':'none','status':'diagnostic_not_truth','pages':pages},indent=2)+'\n', encoding='utf-8')
