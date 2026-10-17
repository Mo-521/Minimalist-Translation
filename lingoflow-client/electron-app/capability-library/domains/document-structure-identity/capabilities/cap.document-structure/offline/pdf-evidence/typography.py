"""Read-only glyph typography for semantic boundary evidence, never reviewer truth."""
import argparse,json,re,statistics
from collections import Counter
from pathlib import Path
import pdfplumber
parser=argparse.ArgumentParser()
parser.add_argument('--source-inventory',type=Path, required=True)
parser.add_argument('--candidate',type=Path, required=True)
parser.add_argument('--output',type=Path, required=True)
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf-8'))
candidate=json.loads(args.candidate.read_text(encoding='utf-8'))
pages={}
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for key,sp in source['pages'].items():
            if int(key.split(':')[0])!=meta['paper']:continue
            p=candidate['pages'][key];ids={sid for o in p['objects'] if o['type'] in ('body','heading') for sid in o['sourceLineIds']};chars=pdf.pages[int(key.split(':')[1])-1].chars;out={}
            for l in sp['sourceLines']:
                if l['sourceLineId'] not in ids:continue
                b=l['bbox'];cs=[c for c in chars if re.fullmatch('[A-Za-z]',c['text']) and b['x']-1<=(c['x0']+c['x1'])/2<=b['x']+b['width']+1 and ((b['y']-b['height']-1<=(c['top']+c['bottom'])/2<=b['y']+1) if l.get('sourceSpanKind') else abs((c['top']+c['bottom'])/2-b['y'])<=max(8,min(14,b['height']*.55)))]
                if not cs:continue
                fonts=Counter(c['fontname'].split('+')[-1] for c in cs)
                out[l['sourceLineId']]={'font':fonts.most_common(1)[0][0],'size':statistics.median(c['size'] for c in cs),'boldRatio':sum(bool(re.search(r'Bold|CMB|LMB',c['fontname'],re.I)) for c in cs)/len(cs),'glyphCount':len(cs),'top':min(c['top'] for c in cs),'bottom':max(c['bottom'] for c in cs)}
            pages[key]=out
    print(json.dumps({'paper':meta['paper']}),flush=True)
args.output.write_text(json.dumps({'authority':'none','pages':pages},indent=2)+'\n',encoding='utf-8')
