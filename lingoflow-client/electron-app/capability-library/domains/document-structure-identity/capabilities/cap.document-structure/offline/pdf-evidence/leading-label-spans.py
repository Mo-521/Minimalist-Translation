"""Split printed leading labels even when their parent is already formula."""
import json
import re
import argparse
from pathlib import Path
import pdfplumber
parser=argparse.ArgumentParser(description='Extract leading label spans from the current PDF candidate')
parser.add_argument('--candidate',type=Path, required=True)
parser.add_argument('--source-inventory',type=Path, required=True)
parser.add_argument('--output',type=Path, required=True)
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf-8'))
candidate=json.loads(args.candidate.read_text(encoding='utf-8'))
matched,unmatched=[],[]
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for number,pdfpage in enumerate(pdf.pages,1):
            key=f"{meta['paper']}:{number}"
            owners={id:o['type'] for o in candidate['pages'][key]['objects']+candidate['pages'][key].get('referenceObjectRefs',[]) for id in o['sourceLineIds']}
            chars=pdfpage.chars
            for line in source['pages'][key]['sourceLines']:
                match=re.match(r'^(\(\d{1,3}(?:\.\d+)?[a-z]?\))\s*(.+)$',line['text'].strip())
                if not match or owners.get(line['sourceLineId']) in ('equation_number','reference','figure','table','heading','caption'):
                    continue
                label,rest=match.groups()
                continuation=bool(re.match(r'^[+−-]\s*\d',rest) and len(re.findall(r'[A-Za-zα-ω]+[_\w]*\(',rest))>=2)
                if not re.search('[=≈≃≤≥⩽⩾<>≡:=∑∫√]',rest) and not continuation:
                    continue
                natural=[w for w in re.findall(r'\b[A-Za-z]{3,}\b',rest) if w.lower() not in {'and','sin','cos','dim','span','log','lim','max','min'}]
                if len(natural)>3 or re.search(r'\b(?:Assumption|Thus|Wherever|There|The|This|define)\b',rest,re.I):
                    continue
                b=line['bbox'];options=[]
                for first in chars:
                    if first['text']!='(' or abs(first['x0']-b['x'])>4:
                        continue
                    row=sorted((c for c in chars if abs(c['top']-first['top'])<2.5 and c['x0']>=first['x0']-.2),key=lambda c:c['x0'])
                    selected=[]
                    for char in row:
                        if not selected and char is not first:
                            continue
                        if selected and char['x0']-selected[-1]['x1']>2.5:
                            break
                        selected.append(char);text=''.join(c['text'] for c in selected)
                        if text==label or not label.startswith(text):
                            break
                    if ''.join(c['text'] for c in selected)!=label:
                        continue
                    visual=dict(x=min(c['x0'] for c in selected),y=min(c['top'] for c in selected),
                        width=max(c['x1'] for c in selected)-min(c['x0'] for c in selected),
                        height=max(c['bottom'] for c in selected)-min(c['top'] for c in selected))
                    distance=abs(visual['y']+visual['height']/2-b['y'])
                    if distance<=max(15,b['height']*1.4):
                        options.append((distance,visual))
                options.sort(key=lambda x:x[0])
                if not options or len(options)>1 and options[1][0]-options[0][0]<1:
                    unmatched.append(dict(page=key,sourceLineId=line['sourceLineId'],reason='label_character_match_ambiguous'));continue
                visual=options[0][1];left=visual['x']+visual['width']+2
                matched.append(dict(page=key,parentSourceLineId=line['sourceLineId'],labelText=label,formulaText=rest,
                    labelBox=visual,formulaBox=dict(x=left,y=b['y']-b['height'],width=b['x']+b['width']-left,height=b['height']),
                    evidence='original_pdf_unique_leading_label_characters'))
args.output.write_text(json.dumps(dict(authority='none',matched=matched,unmatched=unmatched),ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(matched=len(matched),unmatched=len(unmatched))))
