"""Native row and math-font support for every paper; no reviewer coordinates."""
import argparse,json,re,statistics,math,subprocess,tempfile
from pathlib import Path
import pdfplumber
from PIL import Image
parser=argparse.ArgumentParser()
parser.add_argument('--source-inventory',type=Path,required=True)
parser.add_argument('--candidate',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
images=parser.add_mutually_exclusive_group(required=True)
images.add_argument('--page-images',type=Path)
images.add_argument('--pdftoppm',type=Path)
parser.add_argument('--include-fraction-rules',action='store_true')
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf-8'))
candidate=json.loads(args.candidate.read_text(encoding='utf-8'))
def box(cs):return dict(x=min(c['x0'] for c in cs),y=min(c['top'] for c in cs),width=max(c['x1'] for c in cs)-min(c['x0'] for c in cs),height=max(c['bottom'] for c in cs)-min(c['top'] for c in cs)) if cs else None
pages={}
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for key,sp in source['pages'].items():
            if int(key.split(':')[0])!=meta['paper']:continue
            page=candidate['pages'][key];number=int(key.split(':')[1]);p=pdf.pages[number-1];out={}
            if args.page_images:
                raw=Image.open(args.page_images/f"paper{meta['paper']}-page{number:02}.jpg").convert('L')
            else:
                with tempfile.TemporaryDirectory(dir=args.output.parent) as temporary:
                    base=Path(temporary)/'page'
                    rendered=subprocess.run([str(args.pdftoppm),'-f',str(number),'-l',str(number),
                                             '-singlefile','-jpeg','-r','115',str(meta['sourceFile']),str(base)],
                                            capture_output=True)
                    if rendered.returncode:
                        raise RuntimeError(rendered.stderr.decode(errors='replace'))
                    raw=Image.open(base.with_suffix('.jpg')).convert('L').copy()
            im=raw.point(lambda v:255 if v<140 else 0)
            sx=im.width/sp['pageSize']['width'];sy=im.height/sp['pageSize']['height']
            def ink(c):
                a=max(0,math.floor(c['x0']*sx));t=max(0,math.floor(c['top']*sy));z=min(im.width,math.ceil(c['x1']*sx));d=min(im.height,math.ceil(c['bottom']*sy))
                crop=im.crop((a,t,z,d)).getbbox()
                return dict(x=(a+crop[0])/sx,y=(t+crop[1])/sy,width=(crop[2]-crop[0])/sx,height=(crop[3]-crop[1])/sy) if crop else None
            ids={sid for o in page['objects'] if o['type'] in ('body','formula') for sid in o['sourceLineIds']}|{l['sourceLineId'] for l in page['pendingMembership']}
            for l in sp['sourceLines']:
                if l['sourceLineId'] not in ids:continue
                b=l['bbox'];cs=[c for c in p.chars if c['text'].strip() and b['x']-1<=(c['x0']+c['x1'])/2<=b['x']+b['width']+1 and (b['y']-b['height']-2<=(c['top']+c['bottom'])/2<=b['y']+4 or ('CMEX' in c['fontname'] and b['y']-b['height']-2<=c['top']<=b['y']+2))]
                if not cs:continue
                out[l['sourceLineId']]={'box':box(cs),'chars':[dict(text=c['text'],box=box([c]),inkBox=ink(c),font=c['fontname'],size=c['size']) for c in cs]}
            record={'lines':out}
            if args.include_fraction_rules:
                record['fractionRules']=[dict(x=e['x0'],y=e['top'],width=e['x1']-e['x0'],height=e['bottom']-e['top']) for e in p.edges if e.get('orientation')=='h' and 8<e['x1']-e['x0']<200 and e['bottom']-e['top']<1]
            pages[key]=record
    print(json.dumps(dict(paper=meta['paper'])),flush=True)
args.output.write_text(json.dumps(dict(authority='none',status='diagnostic_not_truth',pages=pages),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
