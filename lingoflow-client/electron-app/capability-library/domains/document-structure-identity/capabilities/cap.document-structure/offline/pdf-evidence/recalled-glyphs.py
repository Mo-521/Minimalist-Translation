"""PDF character extents for the recalled display members only."""
import argparse,json,pathlib
parser=argparse.ArgumentParser()
parser.add_argument('--source-inventory',type=pathlib.Path, required=True)
parser.add_argument('--recall-audit',type=pathlib.Path, required=True)
parser.add_argument('--output',type=pathlib.Path, required=True)
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf8'))
ops=json.loads(args.recall_audit.read_text(encoding='utf8'))['operations']
targets={}
for op in ops:
    if op['kind']=='display_recalled':targets.setdefault(op['key'],set()).add(op['sourceLineId'])
matched,held=[],[]
if not targets:
    args.output.write_text(json.dumps({'authority':'none','matched':matched,'held':held},ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'matched':0,'held':0}))
    raise SystemExit(0)
import pdfplumber
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for number,page in enumerate(pdf.pages,1):
            key=f"{meta['paper']}:{number}"
            if key not in targets:continue
            for line in source['pages'][key]['sourceLines']:
                if line['sourceLineId'] not in targets[key]:continue
                b=line['bbox'];tol=max(7,b['height']*.8)
                chars=[c for c in page.chars if c['text'].strip() and b['x']-2<=(c['x0']+c['x1'])/2<=b['x']+b['width']+2 and abs((c['top']+c['bottom'])/2-b['y'])<=tol]
                if len(chars)<2:
                    held.append({'key':key,'sourceLineId':line['sourceLineId'],'reason':'no_unique_glyph_support'});continue
                actual={'x':min(c['x0'] for c in chars)-1,'y':min(c['top'] for c in chars)-1,
                        'width':max(c['x1'] for c in chars)-min(c['x0'] for c in chars)+2,
                        'height':max(c['bottom'] for c in chars)-min(c['top'] for c in chars)+2}
                matched.append({'key':key,'sourceLineId':line['sourceLineId'],'box':actual,'sourceText':line['text']})
args.output.write_text(json.dumps({'authority':'none','matched':matched,'held':held},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'matched':len(matched),'held':len(held)}))
