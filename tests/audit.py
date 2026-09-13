from pathlib import Path
from html.parser import HTMLParser
from collections import Counter
import subprocess,re,json
r=Path(__file__).resolve().parents[1];issues=[];inline_count=0
class Page(HTMLParser):
 def __init__(self):super().__init__();self.ids=[];self.refs=[];self.inline=[];self.script=None
 def handle_starttag(self,t,aa):
  a=dict(aa)
  if 'id' in a:self.ids.append(a['id'])
  if t in ['a','script','link','img']:self.refs.append((t,a.get('src',a.get('href',''))))
  if t=='script' and not a.get('src'):self.script=''
 def handle_data(self,d):
  if self.script is not None:self.script+=d
 def handle_endtag(self,t):
  if t=='script' and self.script is not None:self.inline.append(self.script);self.script=None
for p in r.rglob('*.html'):
 s=Page();raw=p.read_text();s.feed(raw)
 if len(re.findall('<!doctype html>',raw,re.I))!=1:issues.append(f'{p}: invalid doctype count')
 for v,n in Counter(s.ids).items():
  if n>1:issues.append(f'{p}: duplicate id {v}')
 for tag,a in s.refs:
  a=a.split('?')[0].split('#')[0]
  if not a or a.startswith(('http','data:','mailto:','tel:','javascript:','/')):continue
  if not (p.parent/a).exists():issues.append(f'{p}: missing {a}')
 for src in s.inline:
  if not src.strip():continue
  inline_count+=1;t=subprocess.run(['node','--check'],input=src,capture_output=True,text=True)
  if t.returncode:issues.append(f'{p}: {t.stderr}')
for p in r.rglob('*.js'):
 t=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
 if t.returncode:issues.append(t.stderr)
result={'html_pages':len(list(r.rglob('*.html'))),'javascript_files':len(list(r.rglob('*.js'))),'inline_scripts':inline_count,'issues':issues}
print(json.dumps(result,indent=2));raise SystemExit(bool(issues))
