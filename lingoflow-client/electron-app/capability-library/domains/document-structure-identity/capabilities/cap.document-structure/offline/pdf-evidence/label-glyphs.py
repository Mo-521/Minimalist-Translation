"""Original glyph corroboration for label partitions; no human frame inputs."""
import argparse, json, re
from pathlib import Path
import pdfplumber
parser=argparse.ArgumentParser()
parser.add_argument('--source-inventory',type=Path, required=True)
parser.add_argument('--candidate',type=Path, required=True)
parser.add_argument('--output',type=Path, required=True)
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf-8'))
candidate=json.loads(args.candidate.read_text(encoding='utf-8'))
matched=[];held=[];anchors={}
def box(cs):
    return dict(x=min(c['x0'] for c in cs),y=min(c['top'] for c in cs),width=max(c['x1'] for c in cs)-min(c['x0'] for c in cs),height=max(c['bottom'] for c in cs)-min(c['top'] for c in cs)) if cs else None
for meta in source['papers']:
    paper=meta['paper']
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for key,sp in source['pages'].items():
            if int(key.split(':')[0])!=paper:continue
            page=candidate['pages'][key];by_id={l['sourceLineId']:l for l in sp['sourceLines']}
            owners={sid:o for o in page['objects'] for sid in o['sourceLineIds']}
            pending={p['sourceLineId'] for p in page['pendingMembership']}
            chars=[c for c in pdf.pages[int(key.split(':')[1])-1].chars if c['text'].strip()]
            anchors[key]=[]
            for o in page['objects']:
                if o['type']!='formula':continue
                for sid in o['sourceLineIds']:
                    l=by_id[sid];b=l['bbox']
                    if not re.fullmatch(r'[XZ∑∫Σ]',l['text'].strip()):continue
                    cs=[c for c in chars if b['x']-1<= (c['x0']+c['x1'])/2 <= b['x']+b['width']+1 and abs((c['top']+c['bottom'])/2-b['y'])<=14 and re.search(r'CMEX|CMSY|STIX|Symbol',c['fontname'])]
                    if cs:anchors[key].append(dict(objectId=o['objectId'],sourceLineId=sid,box=box(cs),fonts=sorted({c['fontname'] for c in cs})))
                # Some extractors fuse the operator into a larger mathematical
                # row. CMEX encoded sum/integral glyphs still provide an anchor;
                # parentheses and other extension-font glyphs are not anchors.
                for c in chars:
                    if not (c['text'] in ('∑','∫','(cid:88)','(cid:90)') and 'CMEX' in c['fontname']):continue
                    if not any(f['bbox']['x'] <= (c['x0']+c['x1'])/2 <= f['bbox']['x']+f['bbox']['width'] and f['bbox']['y'] <= (c['top']+c['bottom'])/2 <= f['bbox']['y']+f['bbox']['height'] for f in o['spatialFragments']):continue
                    if any(a['objectId']==o['objectId'] and abs(a['box']['x']-c['x0'])<1 for a in anchors[key]):continue
                    anchors[key].append(dict(objectId=o['objectId'],sourceLineId=None,box=box([c]),fonts=[c['fontname']],evidence='encoded_operator_inside_existing_display'))
            for l in sp['sourceLines']:
                owner=owners.get(l['sourceLineId']);b=l['bbox'];prefix=re.match(r'^(\(\d{1,3}(?:\.\d+)*\))(\s+.+)$',l['text']);suffix=re.match(r'^(.+?)(\s*\(\d{1,3}(?:\.\d+)*\))$',l['text'])
                mode=None
                if prefix and owner and owner['type']=='body':
                    others=[by_id[sid] for sid in owner['sourceLineIds'] if sid!=l['sourceLineId'] and len(re.findall(r'[A-Za-z]{3,}',by_id[sid]['text']))>=4]
                    if not others:continue
                    xs=sorted(q['bbox']['x'] for q in others);lane=xs[len(xs)//2]
                    if lane-b['x']<b['height']*1.8:continue
                    mode='left_label_prose';label=prefix[1];cut=len(label)
                elif suffix and l['sourceLineId'] in pending and re.search(r'[=≤≥∈≡]',suffix[1]) and len(re.findall(r'[A-Za-z]{3,}',suffix[1]))<=2:
                    mode='right_label_display';label=suffix[2].strip();cut=len(suffix[1])
                if not mode:continue
                row=[c for c in chars if b['x']-1<=(c['x0']+c['x1'])/2<=b['x']+b['width']+1 and abs((c['top']+c['bottom'])/2-b['y'])<=max(8,min(14,b['height']*.55))]
                ordered=sorted(row,key=lambda c:c['x0']);label_chars=None
                for i in range(len(ordered)-len(label)+1):
                    part=ordered[i:i+len(label)]
                    if ''.join(c['text'] for c in part)==label and (abs(part[0]['x0']-b['x'])<2 if mode=='left_label_prose' else abs(part[-1]['x1']-b['x']-b['width'])<2):label_chars=part;break
                if not label_chars:held.append(dict(key=key,sourceLineId=l['sourceLineId'],reason='printed_label_glyph_mismatch'));continue
                lb=box(label_chars)
                rest=[c for c in row if c['x0']>=lane-1] if mode=='left_label_prose' else [c for c in row if c['x1']<lb['x']-2]
                rb=box(rest)
                if not rb:continue
                # Printed label must be independently compatible with a display
                # on its own side, not merely a number at the start of prose.
                if mode=='left_label_prose':
                    near=[o['objectId'] for o in page['objects'] if o['type']=='formula' and any(f['bbox']['x']+f['bbox']['width']<=lb['x']+2 and lb['x']-f['bbox']['x']-f['bbox']['width']<100 and f['bbox']['y']-4<lb['y']+lb['height']/2<f['bbox']['y']+f['bbox']['height']+4 for f in o['spatialFragments'])]
                    if len(near)!=1:held.append(dict(key=key,sourceLineId=l['sourceLineId'],reason='left_display_target_ambiguous',targets=near));continue
                    if rb['x']-lb['x']-lb['width']<4:continue
                else:
                    near=[]
                    # Recall needs a normal prose lane and an isolated indented
                    # mathematical region, not a prose sentence ending in (n).
                    bodies=[f['bbox'] for o in page['objects'] if o['type']=='body' for f in o['spatialFragments'] if f['bbox']['x']<=rb['x'] and f['bbox']['x']+f['bbox']['width']>=rb['x']+rb['width']]
                    if not any(rb['x']-q['x']>b['height']*2 for q in bodies):held.append(dict(key=key,sourceLineId=l['sourceLineId'],reason='pending_display_isolation_insufficient'));continue
                matched.append(dict(key=key,parentSourceLineId=l['sourceLineId'],mode=mode,cut=cut,labelBox=lb,contentBox=rb,displayTargets=near,upstreamHintConflict=mode=='left_label_prose'))
    print(json.dumps({'paper':paper,'partitions':len(matched)}),flush=True)
args.output.write_text(json.dumps(dict(authority='none',matched=matched,held=held,operatorAnchors=anchors),indent=2)+'\n',encoding='utf-8')
