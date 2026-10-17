"""Read-only original-PDF evidence for front matter, furniture and bitmap bounds."""
import argparse,json,re,statistics,difflib
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
def box(cs):
    return dict(x=min(c['x0'] for c in cs),y=min(c['top'] for c in cs),width=max(c['x1'] for c in cs)-min(c['x0'] for c in cs),height=max(c['bottom'] for c in cs)-min(c['top'] for c in cs)) if cs else None
def letters(t):return ''.join(c.lower() for c in t if c.isalpha())
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for key,sp in source['pages'].items():
            if int(key.split(':')[0])!=meta['paper']:continue
            page=candidate['pages'][key];number=int(key.split(':')[1]);p=pdf.pages[number-1];out={}
            furniture={x['sourceLineId'] for x in page['excludedSourceLines'] if x.get('exclusionReason') in ('page_number','running_header','running_footer')}
            ids=set(furniture)
            if number==1:ids.update(l['sourceLineId'] for l in sp['sourceLines'] if l['bbox']['y']<sp['pageSize']['height']*.5)
            for l in sp['sourceLines']:
                if l['sourceLineId'] not in ids:continue
                b=l['bbox'];cs=[c for c in p.chars if c['text'].strip() and b['x']-1<=(c['x0']+c['x1'])/2<=b['x']+b['width']+1 and abs((c['top']+c['bottom'])/2-b['y'])<=max(8,min(14,b['height']*.55))]
                if not cs:continue
                raw_cs=list(cs);target=letters(l['text']);groups=[]
                for c in sorted(cs,key=lambda c:(c['top']+c['bottom'])/2):
                    cy=(c['top']+c['bottom'])/2
                    if not groups or abs(cy-statistics.median((q['top']+q['bottom'])/2 for q in groups[-1]))>3:groups.append([c])
                    else:groups[-1].append(c)
                scored=[(difflib.SequenceMatcher(None,target,letters(''.join(c['text'] for c in sorted(g,key=lambda c:c['x0'])))).ratio(),g) for g in groups] if target else []
                similarity=1
                if scored:
                    similarity,g=max(scored,key=lambda x:x[0]);cy=statistics.median((q['top']+q['bottom'])/2 for q in g);size=statistics.median(q['size'] for q in g)
                    cs=[c for c in cs if abs((c['top']+c['bottom'])/2-cy)<size*.65]
                english=[c for c in cs if c['text'].isalpha()];fonts=Counter(c['fontname'].split('+')[-1] for c in english or cs)
                out[l['sourceLineId']]={'box':box(cs),'font':fonts.most_common(1)[0][0],'size':statistics.median(c['size'] for c in english or cs),'textSimilarity':similarity,'glyphText':''.join(c['text'] for c in sorted(cs,key=lambda c:c['x0']))}
                prefix=re.match(r'^(\d{1,2}\s+)([A-Za-z].+)$',l['text'])
                if prefix and similarity>.9 and not out[l['sourceLineId']]['glyphText'].startswith(prefix[1].strip()):
                    digits=[c for c in raw_cs if c['text']==prefix[1].strip() and abs(c['x0']-b['x'])<2]
                    if len(digits)==1:
                        d=box(digits);g=box(cs)
                        if g['x']-d['x']-d['width']>out[l['sourceLineId']]['size']*3 and abs(d['y']+d['height']/2-g['y']-g['height']/2)>out[l['sourceLineId']]['size']*.6:
                            out[l['sourceLineId']]['offRowPrefix']={'splitAt':len(prefix[1]),'prefixBox':d,'mainBox':g,'prefixText':prefix[1],'mainText':prefix[2]}
            images=[dict(x=i['x0'],y=i['top'],width=i['x1']-i['x0'],height=i['bottom']-i['top']) for i in p.images]
            pages[key]={'lines':out,'images':images}
    print(json.dumps({'paper':meta['paper']}),flush=True)
args.output.write_text(json.dumps({'authority':'none','pages':pages},indent=2)+'\n',encoding='utf-8')
