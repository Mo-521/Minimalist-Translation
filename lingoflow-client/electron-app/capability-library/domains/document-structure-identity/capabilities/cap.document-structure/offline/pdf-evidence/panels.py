"""Original PDF panel evidence; no human frame or sample-specific rule input."""
import json, pathlib, argparse, pdfplumber
parser=argparse.ArgumentParser(description='Extract panel evidence from the current PDF inventory')
parser.add_argument('--source-inventory',type=pathlib.Path, required=True)
parser.add_argument('--output',type=pathlib.Path, required=True)
args=parser.parse_args()
inventory=json.loads(args.source_inventory.read_text(encoding='utf8'))
paper_paths={item['paper']:item['sourceFile'] for item in inventory['papers']}
out={}
for paper in sorted({p['paper'] for p in inventory['pages'].values()}):
    with pdfplumber.open(paper_paths[paper]) as pdf:
        for number,page in enumerate(pdf.pages,1):
            panels=[]
            for c in page.curves:
                if c['width']<80 or c['height']<25 or not (c.get('stroke') or c.get('fill')): continue
                b={'x':c['x0'],'y':c['top'],'width':c['width'],'height':c['height']}
                chars=[a for a in page.chars if c['x0']<= (a['x0']+a['x1'])/2<=c['x1'] and c['top']<= (a['top']+a['bottom'])/2<=c['bottom'] and a['text'].strip()]
                if len(chars)<30: continue
                mono=sum(any(f in a['fontname'].lower() for f in ['courier','mono','cmtt','inconsolata','typewriter']) for a in chars)/len(chars)
                panels.append({'bbox':b,'monospaceRatio':mono,'charCount':len(chars)})
            # Nested inner/outer borders describe one panel, not two objects.
            panels.sort(key=lambda p:p['bbox']['width']*p['bbox']['height'],reverse=True)
            unique=[]
            for p in panels:
                b=p['bbox']
                if any(b['x']>=q['bbox']['x']-1 and b['y']>=q['bbox']['y']-1 and b['x']+b['width']<=q['bbox']['x']+q['bbox']['width']+1 and b['y']+b['height']<=q['bbox']['y']+q['bbox']['height']+1 for q in unique): continue
                unique.append(p)
            qualified=[p for p in unique if p['monospaceRatio']>=.35 or len(unique)>=3 and any(q['monospaceRatio']>=.35 for q in unique)]
            if qualified:out[f'{paper}:{number}']=qualified
args.output.write_text(json.dumps({'authority':'none','pages':out},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'pages':len(out),'panels':sum(map(len,out.values()))}))
