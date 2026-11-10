// Suggestions are limited to document identity; ingredient tables never supply product CAS.
const sep='\\s*[:：=]?\\s*';
const labels={
 name:new RegExp('^(?:product\\s*(?:name|identifiers?)|(?:trade|commercial|material|chemical|substance)\\s*name|(?:name|identification)\\s+of\\s+(?:the\\s+)?(?:substance|product|mixture)(?:\\s*[/]\\s*(?:mixture|substance))?|GHS\\s*product\\s*identifier|产品名称|化学品名称)(?=\\s|[:：=]|$)'+sep,'i'),
 code:new RegExp('^(?:(?:product|catalog(?:ue)?|article|item|material|stock|reference)\\s*(?:code|number|no\\.?|#)|cat\\.?\\s*(?:no\\.?|number|#)|SKU)(?=\\s|[:：=]|$)'+sep,'i'),
 cas:new RegExp('^CAS\\s*[- ]?\\s*(?:(?:registry\\s*)?(?:number|no\\.?|RN|#))?(?=\\s|[:：=]|$)'+sep,'i'),
 supplier:new RegExp('^(?:(?:manufacturer\\s*[/&]\\s*supplier|supplier\\s*[/&]\\s*manufacturer)|(?:company|supplier|manufacturer|distributor)(?:\\s*(?:name|details))?|name\\s+of\\s+(?:the\\s+)?(?:supplier|manufacturer))(?=\\s|[:：=]|$)'+sep,'i'),
 concentration:new RegExp('^(?:concentration(?:\\s*[/]\\s*formulation)?|purity|assay)(?=\\s|[:：=]|$)'+sep,'i')
};
const revisionLabel=/(?:revision\s*date|date\s*(?:of\s*)?(?:revision|revised|last\s*revision)|last\s*(?:revised|updated)|revised\s*(?:on|date)|修订日期)\s*[:：=]?\s*(.*)/i;
const issueLabel=/(?:issue\s*date|date\s*of\s*(?:issue|preparation|compilation)|(?:preparation|creation|compilation)\s*date)\s*[:：=]?\s*(.*)/i;
const stop=/^(?:CAS\b|synonyms?\b|alternative\s+name|recommended\b|relevant\b|identified\s+uses|uses?\s+advised|application\s+of|details\s+of|company\b|supplier\b|manufacturer\b|emergency\b|telephone\b|fax\b|tel\b|brand\b|index[- ]|EC\s*(?:number|no)|registration\s+number|molecular\b|information\s+department|revision\b|creation\b|print(?:ing)?\s*date|SAFETY DATA SHEET|\d+\.\s*[A-Za-z]|\d+\.\d{1,2}(?=\s|$)|SECTION\s*\d+)/i;
const clean=s=>s.replace(/\u00a0/g,' ').trim().replace(/^[•·●▪*–—]\s*/,'').replace(/^\s*1\.\d{1,2}\.?(?:\s+|$)/,'').trim();
const isLabel=s=>Object.values(labels).some(p=>p.test(clean(s)))||stop.test(clean(s));
const laterSection=s=>/^(?:SECTION\s*)?(?:[2-9]|1[0-6])(?:\s*[.:\-]\s*|\s+)(?:Hazard|Composition|First|Fire|Accidental|Handling|Exposure|Physical|Stability|Toxicological|Ecological|Disposal|Transport|Regulatory|Other)/i.test(s)||/^SECTION\s+(?:[2-9]|1[0-6])\b/i.test(s);
export function parseDate(value){
 let m=value.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/),y,month,day;
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 if(m){y=+m[1];month=+m[2];day=+m[3]}else{
  m=value.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s.-]+([A-Za-z]{3,9})[\s.,-]+(\d{4})\b/);
  if(m){day=+m[1];month=months.indexOf(m[2].slice(0,3).toLowerCase())+1;y=+m[3]}
  else{m=value.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})\b/);if(m){month=months.indexOf(m[1].slice(0,3).toLowerCase())+1;day=+m[2];y=+m[3]}else{
   m=value.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);if(!m||(+m[1]<=12&&+m[2]<=12&&+m[1]!==+m[2]))return null;day=+m[1]>12?+m[1]:+m[2];month=+m[1]>12?+m[2]:+m[1];y=+m[3];
  }}
 }
 const d=new Date(Date.UTC(y,month-1,day));if(!month||y<1900||d.getUTCFullYear()!==y||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
 return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function validCAS(value){const digits=value.replaceAll('-','');let sum=0;for(let i=digits.length-2,w=1;i>=0;i--,w++)sum+=Number(digits[i])*w;return sum%10===Number(digits.at(-1))}
export function extractFields(pages){
 const fields={},evidence={},warnings=[],revisionCandidates=[],issueCandidates=[];let identityOpen=true,sawRevision=false;
 function set(key,value,p,excerpt){if(!value||fields[key])return;fields[key]=value.replace(/\s+/g,' ').trim().slice(0,2000);evidence[key]={page:p.page,excerpt:excerpt.trim().slice(0,600)}}
 for(const p of pages){
  const lines=p.text.split(/\n/).map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
   const original=lines[i],line=clean(original);if(laterSection(line))identityOpen=false;
   if(identityOpen){
    for(const key of ['name','code','cas','supplier','concentration']){
     if(!labels[key].test(line))continue;let value=line.replace(labels[key],'').trim(),excerpt=original,consumed=i;
     if(!value){for(let j=i+1;j<Math.min(i+4,lines.length);j++){const next=clean(lines[j]).replace(/^[:：=]\s*/,'');if(isLabel(next)||laterSection(next)||/^1\.\d{1,2}$/.test(next))break;if(next){value=next;consumed=j;excerpt+='\n'+lines[j];break}}}
     if(!value||isLabel(value)||/^(?:not\s*(?:available|applicable)|no information|identification|details\s+of|[-:])$/i.test(value))continue;
     if(key==='name'||key==='code'){
      for(let j=consumed+1;j<Math.min(consumed+4,lines.length);j++){const next=clean(lines[j]);if(isLabel(next)||laterSection(next)||/^1\.\d{0,2}$/.test(next)||/^[:：]/.test(next)||/^\(?Contd|^Page\s*\d/i.test(next))break;if(key==='code'&&!/^[A-Z0-9][A-Z0-9._/; ,\-]*\d[A-Z0-9._/; ,\-]*$/i.test(next))break;if(key==='name'&&(next.length>160||/^(?:e-?mail|website|www\.|https?:|\d+\s+\w)/i.test(next)))break;value+=' '+next;excerpt+='\n'+lines[j]}
     }
     if(key==='cas'){const values=(value.match(/\b\d{2,7}-\d{2}-\d\b/g)||[]).filter(validCAS);if(values.length)set(key,[...new Set(values)].join(', '),p,excerpt)}
     else set(key,value,p,excerpt);
    }
    // Some REACH layouts put the supplier name directly after the 1.3 heading.
    if(/^details\s+of\s+the\s+supplier\s+of\s+the\s+safety\s+data\s+sheet\s*:?$/i.test(line)){
     const next=clean(lines[i+1]||'');if(next&&!isLabel(next)&&!laterSection(next)&&/[A-Za-z]/.test(next)&&!/^\d|^https?:|^www\./i.test(next))set('supplier',next,p,original+'\n'+lines[i+1]);
    }
   }
   for(const [pattern,list,type]of [[revisionLabel,revisionCandidates,'revision'],[issueLabel,issueCandidates,'issue']]){const m=line.match(pattern);if(!m)continue;if(type==='revision')sawRevision=true;let value=m[1];if(!value)value=clean(lines[i+1]||'').replace(/^[:：=]\s*/,'');const date=parseDate(value);if(date)list.push({date,p,excerpt:original+(m[1]?'':'\n'+value)});}
  }
 }
 const candidates=sawRevision?revisionCandidates:issueCandidates,dates=[...new Set(candidates.map(c=>c.date))];
 if(dates.length===1){const c=candidates[0];set('revision',c.date,c.p,(sawRevision?'':'Issue/compilation date (no revision date label found): ')+c.excerpt)}
 else if(dates.length>1)warnings.push('Different revision dates detected. Enter the correct SDS date after checking the original.');
 else if(sawRevision)warnings.push('Revision date could not be read unambiguously. Check the original and enter it manually.');
 return {fields,evidence,warnings};
}
export function layoutText(items){
 const rows=[];
 for(const item of items){if(!('str'in item)||!item.str.trim())continue;const x=item.transform[4],y=item.transform[5];let row=rows.find(r=>Math.abs(r.y-y)<2.5);if(!row){row={y,items:[]};rows.push(row)}row.items.push({x,text:item.str})}
 return rows.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ')).join('\n');
}
