"""Scan every paper with identical prefix/physical-row/display-target guards."""
import argparse,json,re,statistics
from pathlib import Path
import pdfplumber
parser=argparse.ArgumentParser()
parser.add_argument('--source-inventory',type=Path, required=True)
parser.add_argument('--candidate',type=Path, required=True)
parser.add_argument('--output',type=Path, required=True)
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf-8'))
candidate=json.loads(args.candidate.read_text(encoding='utf-8'))
def norm(t):return re.sub(r'[\s_]+','',t).replace('ﬁ','fi').replace('ﬂ','fl')
def box(cs):return dict(x=min(c['x0'] for c in cs),y=min(c['top'] for c in cs),width=max(c['x1'] for c in cs)-min(c['x0'] for c in cs),height=max(c['bottom'] for c in cs)-min(c['top'] for c in cs))
def inside(c,b):return b['x']-.3<=(c['x0']+c['x1'])/2<=b['x']+b['width']+.3 and b['y']-.3<=(c['top']+c['bottom'])/2<=b['y']+b['height']+.3
def overlap(a,b):return max(0,min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x']))*max(0,min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y']))
proposals=[];held=[];label_rows=[]
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for key,inv in source['pages'].items():
            if int(key.split(':')[0])!=meta['paper']:continue
            page=candidate['pages'][key];p=pdf.pages[int(key.split(':')[1])-1]; lines={l['sourceLineId']:l for l in inv['sourceLines']}
            for pending in page['pendingMembership']:
                l=lines[pending['sourceLineId']];b=l['bbox']
                if not re.fullmatch(r'[A-Za-z][A-Za-z /-]{1,30}:',l['text'].strip()):continue
                chars=[c for c in p.chars if c['text'].strip() and b['x']-1<=(c['x0']+c['x1'])/2<=b['x']+b['width']+1 and abs((c['top']+c['bottom'])/2-b['y'])<b['height']]
                if not chars or norm(''.join(c['text'] for c in sorted(chars,key=lambda c:c['x0'])))!=norm(l['text']):continue
                label_rows.append(dict(key=key,sourceLineId=l['sourceLineId'],box=box(chars),font=chars[0]['fontname'],size=statistics.median(c['size'] for c in chars)))
            for obj in page['objects']:
                if obj['type']!='body' or not obj['sourceLineIds']:continue
                for sid in obj['sourceLineIds']:
                    line=lines[sid];b=line['bbox']
                    if line.get('sourceSpanKind'):continue
                    cs=[c for c in p.chars if c['text'].strip() and b['x']-1<=(c['x0']+c['x1'])/2<=b['x']+b['width']+1 and b['y']-b['height']-5<=(c['top']+c['bottom'])/2<=b['y']+b['height']]
                    seed=[c for c in cs if any(inside(c,f['bbox']) for f in obj['spatialFragments']) and c['text'].isalpha() and not re.search(r'CMMI|CMSY|CMEX|MSBM|MSAM',c['fontname'])]
                    groups=[]
                    for c in sorted(seed,key=lambda c:(c['top']+c['bottom'])/2):
                        cy=(c['top']+c['bottom'])/2
                        if not groups or abs(cy-statistics.median((q['top']+q['bottom'])/2 for q in groups[-1]))>2.8:groups.append([c])
                        else:groups[-1].append(c)
                    for group in groups:
                        cy=statistics.median((c['top']+c['bottom'])/2 for c in group);h=statistics.median(c['size'] for c in group)
                        row=[c for c in cs if abs((c['top']+c['bottom'])/2-cy)<h*.65 and any(inside(c,f['bbox']) for f in obj['spatialFragments'])]
                        row.sort(key=lambda c:c['x0']);text=norm(''.join(c['text'] for c in row))
                        if len(re.sub('[^A-Za-z]','',text))<2 or not norm(line['text']).startswith(text) or norm(line['text'])==text:continue
                        end=next((i for i in range(1,len(line['text'])+1) if norm(line['text'][:i])==text),None)
                        if end is None:continue
                        tail=line['text'][end:]
                        if len(re.findall(r'[a-z]{3,}',tail))>2:continue
                        prose=box(row)
                        if not (b['height']>prose['height']*1.15 or b['width']>prose['width']*1.6):continue
                        foreign=[c for c in cs if not any(inside(c,f['bbox']) for f in obj['spatialFragments']) and (c['top']+c['bottom'])/2>cy+h*.5]
                        if not foreign:continue
                        region=box(foreign)
                        targets=[o for o in page['objects'] if o['type']=='formula' and any(overlap(region,f['bbox'])>0 for f in o['spatialFragments']) and any(re.search(r'[=≃≈⩾≥≤∑∫]|:=',o['sourceText']) for _ in [0])]
                        if len(targets)!=1:
                            held.append(dict(key=key,sourceLineId=sid,reason='display_target_not_unique',targetCount=len(targets)));continue
                        target=targets[0]
                        if any(overlap(region,f['bbox'])>0 for o in page['objects'] if o['objectId'] not in (obj['objectId'],target['objectId']) and o['type'] not in ('equation_number',) for f in o.get('spatialFragments',[])):
                            held.append(dict(key=key,sourceLineId=sid,reason='foreign_glyph_region_intersects_other_block'));continue
                        if region['y']+region['height']-prose['y']>h*5:continue
                        proposals.append(dict(key=key,sourceLineId=sid,bodyObjectId=obj['objectId'],formulaObjectId=target['objectId'],splitAt=end,proseBox=prose,mathBox=region,proseText=line['text'][:end],mathText=tail,rawMathGlyphs=[dict(text=c['text'],font=c['fontname']) for c in foreign],guards=['exact_native_prose_prefix','physical_row_separation','independent_relational_display','unique_target','no_other_block_conflict']))
                        break
    print(json.dumps(dict(paper=meta['paper'])),flush=True)
args.output.write_text(json.dumps(dict(authority='none',pagesScanned=len(source['pages']),proposals=proposals,held=held,labelRows=label_rows),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(proposals=len(proposals),held=len(held))))
