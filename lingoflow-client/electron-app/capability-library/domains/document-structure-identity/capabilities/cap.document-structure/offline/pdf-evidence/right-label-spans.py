"""Find only PDF-backed right-margin equation labels in mixed source units."""
import argparse,json,re,pathlib,pdfplumber
parser=argparse.ArgumentParser()
parser.add_argument('--source-inventory',type=pathlib.Path, required=True)
parser.add_argument('--candidate',type=pathlib.Path, required=True)
parser.add_argument('--output',type=pathlib.Path, required=True)
args=parser.parse_args()
source=json.loads(args.source_inventory.read_text(encoding='utf8'))
candidate=json.loads(args.candidate.read_text(encoding='utf8'))
matched,held=[],[]
for meta in source['papers']:
    with pdfplumber.open(meta['sourceFile']) as pdf:
        for number,page in enumerate(pdf.pages,1):
            key=f"{meta['paper']}:{number}"
            owners={id:o['type'] for o in candidate['pages'][key]['objects']+candidate['pages'][key].get('referenceObjectRefs',[]) for id in o['sourceLineIds']}
            for line in source['pages'][key]['sourceLines']:
                m=re.fullmatch(r'(.+?)\s*(\(\d{1,3}(?:\.\d+)?[a-z]?\))\s*',line['text'].strip())
                if not m:continue
                math,label=m.groups()
                if owners.get(line['sourceLineId']) in ('reference','figure','table','caption','heading','equation_number','unsupported_structured_block'):continue
                words=[w for w in re.findall(r'[A-Za-z]{3,}',math) if w.lower() not in ('sin','cos','tan','log','exp','lim','dim','span','max','min','arg','sup','inf')]
                if len(words)>3 or not re.search(r'[=≈≃∼≤≥⩽⩾<>∑∫√^_]',math):continue
                b=line['bbox'];options=[]
                for first in page.chars:
                    if first['text']!='(' or first['x0']<page.width*.7:continue
                    row=sorted((c for c in page.chars if abs(c['top']-first['top'])<1.8 and c['x0']>=first['x0']-.1),key=lambda c:c['x0'])
                    selected=[]
                    for char in row:
                        if not selected and char is not first:continue
                        if selected and char['x0']-selected[-1]['x1']>3:break
                        selected.append(char)
                        text=''.join(c['text'] for c in selected)
                        if text==label or not label.startswith(text):break
                    if ''.join(c['text'] for c in selected)!=label:continue
                    visual={'x':min(c['x0'] for c in selected),'y':min(c['top'] for c in selected),'width':max(c['x1'] for c in selected)-min(c['x0'] for c in selected),'height':max(c['bottom'] for c in selected)-min(c['top'] for c in selected)}
                    xdist=abs(visual['x']+visual['width']-(b['x']+b['width']))
                    ydist=abs(visual['y']+visual['height']/2-b['y'])
                    if xdist<=6 and ydist<=max(25,b['height']*1.6) and visual['x']-b['x']>40:
                        options.append((xdist+ydist*.1,visual))
                options.sort(key=lambda o:o[0])
                if not options or len(options)>1 and options[1][0]-options[0][0]<2:
                    held.append({'page':key,'sourceLineId':line['sourceLineId'],'reason':'right_label_pdf_character_match_missing_or_ambiguous','text':line['text']});continue
                label_box=options[0][1]
                math_chars=[c for c in page.chars if b['x']-3<=c['x0']<label_box['x']-6 and
                            b['y']-b['height']-4<=c['top']<=b['y']+max(8,b['height']*.5) and c['text'].strip()]
                if not math_chars:
                    held.append({'page':key,'sourceLineId':line['sourceLineId'],'reason':'no_pdf_math_character_support','text':line['text']});continue
                formula_box={'x':min(c['x0'] for c in math_chars)-1,'y':min(c['top'] for c in math_chars)-1,
                             'width':max(c['x1'] for c in math_chars)-min(c['x0'] for c in math_chars)+2,
                             'height':max(c['bottom'] for c in math_chars)-min(c['top'] for c in math_chars)+2}
                matched.append({'page':key,'parentSourceLineId':line['sourceLineId'],'formulaText':math,'labelText':label,'formulaBox':formula_box,'labelBox':label_box,'formulaTextSpan':[0,len(math)],'labelTextSpan':[len(line['text'].strip())-len(label),len(line['text'].strip())],'evidence':'unique_original_pdf_right_margin_label_characters'})
args.output.write_text(json.dumps({'authority':'none','matched':matched,'held':held},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'matched':len(matched),'held':len(held),'pages':sorted(set(x['page'] for x in matched))},ensure_ascii=False))
