import {LIBRARY_README,recoveryReadme} from './folder-guide.js';
// A provider-neutral local folder store. Immutable revisions avoid overwriting synced edits.
const uuid=/^[a-f0-9-]{36}$/i,pdfname=/^[a-f0-9]{64}\.pdf$/;
const handles=new Promise((resolve,reject)=>{const q=indexedDB.open('sds-folder-settings',1);q.onupgradeneeded=()=>q.result.createObjectStore('settings');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
let folder,configured=false,loaded=false,lastWarnings=[],indexWarning='';
async function setting(value,write=false){const db=await handles;return new Promise((resolve,reject)=>{const tx=db.transaction('settings',write?'readwrite':'readonly'),st=tx.objectStore('settings');let result;const q=write?st.put(value,'folder'):st.get('folder');q.onsuccess=()=>result=q.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error)})}
export async function folderState({checkPermission=false}={}){if(!loaded){folder=await setting();configured=!!folder;loaded=true}let permission;if(checkPermission&&folder)try{permission=await folder.queryPermission({mode:'readwrite'})}catch{permission='unknown'}return {configured,name:folder?.name,supported:'showDirectoryPicker'in window,permission}}
async function requireFolder(){await folderState();if(!folder)throw Error('No storage folder connected.');if(await folder.queryPermission({mode:'readwrite'})!=='granted')throw Error('Folder access needs permission. Click Reconnect folder.');return folder}
export async function connectFolder(reconnect=false){
 if(!('showDirectoryPicker'in window))throw Error('Folder access is unavailable here. Open this app in desktop Chrome or Edge.');
 await folderState();let chosen;
 if(reconnect&&folder){if(await folder.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder access was not granted.');chosen=folder}
 else{try{chosen=await window.showDirectoryPicker({id:'sds-storage',mode:'readwrite'})}catch(e){if(['SecurityError','NotAllowedError'].includes(e.name))throw Error('This browser context blocks folder access. Open the app directly in desktop Chrome or Edge, then click Connect folder.');throw e}}
 // Establish the app-owned subfolder before changing storage mode.
 const app=await chosen.getDirectoryHandle('SDS-Desk',{create:true});await app.getDirectoryHandle('documents',{create:true});await app.getDirectoryHandle('records',{create:true});await ensureLibraryGuide(app);
 await setting(chosen,true);folder=chosen;configured=true;loaded=true;await rebuildFolderIndex();return folderState();
}
export async function disconnectFolder(){await setting(null,true);folder=null;configured=false;loaded=true}
async function dirs(){const root=await requireFolder();const app=await root.getDirectoryHandle('SDS-Desk',{create:true});const system=await app.getDirectoryHandle('_system',{create:true});return {app,documents:await app.getDirectoryHandle('documents',{create:true}),pending:await system.getDirectoryHandle('pending-pdfs',{create:true}),maps:await system.getDirectoryHandle('pdf-index',{create:true}),records:await app.getDirectoryHandle('records',{create:true})}}
async function writeNew(dir,name,blob){const handle=await dir.getFileHandle(name,{create:true}),w=await handle.createWritable();try{await w.write(blob);await w.close()}catch(e){try{await w.abort()}catch{}throw e}}
async function ensureLibraryGuide(app){try{const handle=await app.getFileHandle('README.txt'),file=await handle.getFile();if(file.size<100000){const text=await file.text();if(text===LIBRARY_README.replaceAll('Settings > Maintenance','Settings > Advanced'))await writeNew(app,'README.txt',LIBRARY_README)}}catch(error){if(error.name!=='NotFoundError')throw error;await writeNew(app,'README.txt',LIBRARY_README)}}
export async function finishFolderBatch(){if(!(await folderState()).configured)return true;return rebuildFolderIndex()}
const documentLock=task=>navigator.locks?navigator.locks.request('sds-desk-document-maintenance',task):task();
const pdfDigest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('')+'.pdf';
const pathKey=parts=>parts.join('/').normalize('NFC').toLowerCase();
export function selectRevisions(events){const parents=new Set(events.flatMap(e=>e.parents||[])),tips=events.filter(e=>!parents.has(e.key)).sort((a,b)=>b.record.updated.localeCompare(a.record.updated)||b.key.localeCompare(a.key));if(!tips.length)return null;return {...tips[0].record,_heads:tips.map(e=>e.key).sort(),_conflict:tips.length>1,_variants:tips.map(e=>({key:e.key,record:e.record}))}}
function validateRecord(r,id){if(!r||r.id!==id||!uuid.test(r.id)||typeof r.name!=='string'||!pdfname.test(r.file)||typeof r.updated!=='string')throw Error('Invalid record revision');if(r.history!=null&&(!Array.isArray(r.history)||r.history.some(h=>!h||!pdfname.test(h.file))))throw Error('Invalid PDF history.');return r}
const revisionName=/^v-[a-f0-9-]{36}\.json$/i;
async function readRevision(handle,id){
 const file=await handle.getFile();
 if(!file.size)throw Object.assign(Error('Empty record file (0 bytes).'),{kind:'empty-record',size:0,lastModified:file.lastModified});
 if(file.size>2000000)throw Error('Record exceeds the 2 MB limit.');
 let event;try{event=JSON.parse(await file.text())}catch{throw Error('Record file is not valid JSON.')}
 validateRecord(event?.record,id);
 if(!Array.isArray(event.parents)||event.parents.some(name=>!revisionName.test(name)))throw Error('Invalid record-history references.');
 return event;
}
function recordWarning(id,name,error){return `Record version skipped: records/${id}/${name} — ${error.message||'File could not be read.'} Open Settings → Maintenance → Library health.`}
async function readRecord(parent,id,{strict=false}={}){
 const dir=await parent.getDirectoryHandle(id),events=[],failures=[];
 for await(const [name,handle]of dir.entries()){
  if(handle.kind!=='file'||!revisionName.test(name))continue;
  try{events.push({...await readRevision(handle,id),key:name})}
  catch(error){lastWarnings.push(recordWarning(id,name,error));failures.push(name)}
 }
 if(strict&&failures.length)throw Error(`This record has unreadable versions. Open Settings → Maintenance → Library health before editing it. Affected file: records/${id}/${failures[0]}`);
 return selectRevisions(events);
}
async function writeRevision(dir,id,event){
 validateRecord(event.record,id);const name='v-'+crypto.randomUUID()+'.json',text=JSON.stringify(event,null,2);
 if(new Blob([text]).size>2000000)throw Error('Record exceeds the 2 MB limit. Shorten its notes before saving.');
 try{
  await writeNew(dir,name,text);
  const handle=await dir.getFileHandle(name),stored=await handle.getFile();
  if(await stored.text()!==text)throw Error('The record could not be verified after saving.');
  await readRevision(handle,id);
 }catch(error){
  // A failed write can leave the newly created handle empty. Only remove this
  // unique new revision when it is still empty; retain any non-empty evidence.
  try{const file=await(await dir.getFileHandle(name)).getFile();if(file.size===0)await dir.removeEntry(name)}catch{}
  throw Error(`Record save failed: ${error.message}. Check folder access and available disk space. The PDF may already be saved; review Library health before retrying.`);
 }
 return name;
}
export async function checkLibraryHealth(){
 const {records}=await dirs(),issues=[],selected=[],pdfs=new Map();let versions=0;
 for await(const [id,dir]of records.entries()){
  if(dir.kind!=='directory'||!uuid.test(id))continue;
  const events=[],localIssues=[];
  try{
   for await(const [name,handle]of dir.entries()){
    if(handle.kind!=='file'||!revisionName.test(name))continue;
    try{events.push({...await readRevision(handle,id),key:name});versions++}
    catch(error){localIssues.push({kind:error.kind||'unreadable-record',path:`records/${id}/${name}`,recordId:id,reason:error.message,size:error.size,lastModified:error.lastModified})}
   }
  }catch(error){localIssues.push({kind:'unreadable-folder',path:`records/${id}`,recordId:id,reason:error.message})}
  const record=selectRevisions(events),name=record?.name||'No readable record';if(record)selected.push(record);
  const keys=new Set(events.map(event=>event.key));
  for(const event of events){
   for(const parent of event.parents)if(!keys.has(parent)&&!localIssues.some(issue=>issue.path.endsWith('/'+parent)))localIssues.push({kind:'missing-version',path:`records/${id}/${parent}`,recordId:id,reason:'A referenced history version is missing.'});
   for(const key of [event.record.file,...(event.record.history||[]).map(h=>h.file)])if(!pdfs.has(key))pdfs.set(key,name);
  }
  for(const issue of localIssues)issues.push({...issue,recordName:name});
 }
 for(const [key,name]of pdfs){
  try{const file=await folderPDF(key);if(!file.size||new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw Error('The linked file is empty or is not a PDF.')}
  catch(error){issues.push({kind:'unreadable-pdf',path:`PDF key: ${key}`,recordName:name,reason:error.message})}
 }
 return {checkedAt:new Date().toISOString(),records:selected.length,versions,pdfs:pdfs.size,issues};
}
export async function repairEmptyRecordFiles(report){
 const {app,records}=await dirs(),batch=crypto.randomUUID(),result={moved:[],skipped:[]};let recovery;
 for(const issue of report.issues||[]){
  if(issue.kind!=='empty-record')continue;
  const parts=issue.path.split('/');
  if(parts.length!==3||parts[0]!=='records'||!uuid.test(parts[1])||!revisionName.test(parts[2]))throw Error('Invalid recovery path.');
  const [,id,name]=parts;
  try{
   const dir=await records.getDirectoryHandle(id),handle=await dir.getFileHandle(name),file=await handle.getFile();
   if(file.size!==0||file.lastModified!==issue.lastModified){result.skipped.push(issue.path+' changed after the check. Run Library health again.');continue}
   if(!recovery){const system=await app.getDirectoryHandle('_system',{create:true});const root=await system.getDirectoryHandle('recovery',{create:true});recovery=await root.getDirectoryHandle(batch,{create:true})}
   const recordCopies=await recovery.getDirectoryHandle(id,{create:true});
   await writeNew(recordCopies,name,file);
   const copy=await(await recordCopies.getFileHandle(name)).getFile();if(copy.size!==0)throw Error('Recovery copy could not be verified.');
   const recoveryInfo={format:'sds-recovery-v1',originalPath:issue.path,reason:issue.reason,created:new Date().toISOString()};await writeNew(recordCopies,name+'.recovery.json',JSON.stringify(recoveryInfo,null,2));await writeNew(recordCopies,'README.txt',recoveryReadme(recoveryInfo));
   const current=await handle.getFile();if(current.size!==0||current.lastModified!==file.lastModified){result.skipped.push(issue.path+' changed during recovery and was left in place.');continue}
   await dir.removeEntry(name);result.moved.push(issue.path);
  }catch(error){result.skipped.push(issue.path+': '+error.message)}
 }
 result.recoveryPath=recovery?`_system/recovery/${batch}`:null;
 if(recovery)await writeNew(recovery,'README.txt',`SDS Desk empty-record recovery\n==============================\nCreated: ${new Date().toISOString()}\n\nMoved empty files:\n${result.moved.join('\n')||'None'}\n\nSkipped files:\n${result.skipped.join('\n')||'None'}\n\nCopies and individual audit reports are kept in the record-ID subfolders. No non-empty records were removed.\n`);
 result.indexRebuilt=await rebuildFolderIndex();return result;
}
export async function folderList(){const {records}=await dirs();lastWarnings=[];const rows=[];for await(const [id,h]of records.entries()){if(h.kind==='directory'&&uuid.test(id)){const row=await readRecord(records,id);if(row)rows.push(row)}}if(indexWarning)lastWarnings.push(indexWarning);return {records:rows.sort((a,b)=>b.updated.localeCompare(a.updated)),storage:`Connected folder: ${folder.name} / SDS-Desk · Cloud sync handled by your desktop sync app`,warnings:[...new Set(lastWarnings)]}}
export function safePart(value,fallback='Unknown',limit=54){let out=String(value||'').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^[. -]+|[. -]+$/g,'').slice(0,limit).replace(/[. -]+$/g,'');if(!out)out=fallback;if(/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(out))out='_'+out;return out}
export function documentPath(record,key=record.file,suffix=''){const product=safePart(record.name,'Unnamed-product',32),supplier=safePart(record.supplier,'Unknown-supplier',22),cas=(record.cas||'').match(/\b\d{2,7}-\d{2}-\d\b/)?.[0];const date=/^\d{4}-\d{2}-\d{2}$/.test(record.revision||'')?record.revision:'Undated';return ['documents',product+(cas?'__CAS-'+cas:''),`${product}__${supplier}__SDS-${date}${suffix?'__'+suffix:''}.pdf`]}
async function mappedPath(key,context){const {maps}=context||await dirs();try{const file=await(await maps.getFileHandle(key+'.json')).getFile();if(file.size>20000)throw Error('Invalid PDF path map');const data=JSON.parse(await file.text()),parts=data.path;if(!Array.isArray(parts)||parts.length!==3||parts[0]!=='documents'||parts.some(v=>typeof v!=='string'||!v||v==='.'||v==='..'||/[\\/\x00-\x1f]/.test(v))||!parts[2].endsWith('.pdf'))throw Error('Invalid PDF path map');return parts}catch(e){if(e.name==='NotFoundError')return null;throw e}}
async function fileAt(app,parts){let dir=app;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);return(await dir.getFileHandle(parts.at(-1))).getFile()}
export async function pdfRelativePath(key){if(!pdfname.test(key))throw Error('Invalid PDF key');const d=await dirs(),parts=await mappedPath(key,d);if(parts)return parts.join('/');try{await d.pending.getFileHandle(key);return '_system/pending-pdfs/'+key}catch(e){if(e.name!=='NotFoundError')throw e}return '_system/pending-pdfs/'+key}
export async function folderPDF(key){if(!pdfname.test(key))throw Error('Invalid PDF filename');const d=await dirs(),path=await mappedPath(key,d);if(path){try{return await fileAt(d.app,path)}catch(e){if(e.name!=='NotFoundError')throw e}}
 for(const dir of [d.pending]){try{return await(await dir.getFileHandle(key)).getFile()}catch(e){if(e.name!=='NotFoundError')throw e}}throw Error('PDF not available locally. Wait for cloud sync and keep the shared folder available offline.')}
export async function folderPutPDF(key,blob){if(!pdfname.test(key))throw Error('Invalid PDF filename');try{const existing=await folderPDF(key);if(existing.size===blob.size)return}catch(e){if(e.name!=='NotFoundError'&&!e.message.startsWith('PDF not available'))throw e}const {pending}=await dirs();await writeNew(pending,key,blob)}
async function chooseDocumentPath(record,key,context,claims=new Map()){
 const base=documentPath(record,key);let dir;
 try{dir=await context.documents.getDirectoryHandle(base[1])}catch(error){if(error.name!=='NotFoundError')throw error}
 const existing=new Map();if(dir)for await(const [name,handle]of dir.entries())existing.set(name.normalize('NFC').toLowerCase(),{name,handle});
 for(const suffix of ['',key.slice(0,12),key.slice(0,24),key.slice(0,64)]){
  const candidate=documentPath(record,key,suffix),claim=claims.get(pathKey(candidate));if(claim&&claim!==key)continue;
  const file=existing.get(candidate[2].normalize('NFC').toLowerCase());
  if(file){if(file.handle.kind!=='file')continue;if(await pdfDigest(await file.handle.getFile())!==key)continue;candidate[2]=file.name}
  claims.set(pathKey(candidate),key);return candidate;
 }
 throw Error('Document name is occupied by different files. No file was overwritten.');
}
async function publishPDFMap(context,key,path){
 let old;try{old=await(await(await context.maps.getFileHandle(key+'.json')).getFile()).text()}catch(error){if(error.name!=='NotFoundError')throw error}
 try{await writeNew(context.maps,key+'.json',JSON.stringify({format:'sds-pdf-path-v1',key,path},null,2));const actual=await mappedPath(key,context);if(JSON.stringify(actual)!==JSON.stringify(path))throw Error('PDF link could not be verified.')}
 catch(error){if(old)try{await writeNew(context.maps,key+'.json',old)}catch{}throw error}
}
async function copyVerifiedPDF(context,key,path,blob){
 const dir=await context.documents.getDirectoryHandle(path[1],{create:true});
 try{const existing=await(await dir.getFileHandle(path[2])).getFile();if(await pdfDigest(existing)!==key)throw Error('The destination now contains a different PDF. Check the preview again.');return}
 catch(error){if(error.name!=='NotFoundError')throw error}
 await writeNew(dir,path[2],blob);
 const verified=await(await dir.getFileHandle(path[2])).getFile();if(await pdfDigest(verified)!==key)throw Error('PDF integrity check failed. The original source has been retained.');
}
export async function organisePDF(record,key=record.file){return documentLock(async()=>{
 if(!pdfname.test(key))throw Error('Invalid PDF key');const context=await dirs(),existing=await mappedPath(key,context);
 if(existing){try{const stored=await fileAt(context.app,existing);if(await pdfDigest(stored)!==key)throw Error('The existing PDF failed its integrity check. Run Library health before saving.');return existing.join('/')}catch(error){if(error.name!=='NotFoundError')throw error}}
 const blob=await folderPDF(key);if(await pdfDigest(blob)!==key)throw Error('Source PDF integrity check failed.');
 const path=await chooseDocumentPath(record,key,context);await copyVerifiedPDF(context,key,path,blob);await publishPDFMap(context,key,path);return path.join('/');
})}
async function cleanupPendingKey(key,context){
 const path=await mappedPath(key,context);if(!path)return {removed:false};
 let pending;try{pending=await(await context.pending.getFileHandle(key)).getFile()}catch(error){if(error.name==='NotFoundError')return {removed:false};throw error}
 const document=await fileAt(context.app,path);
 if(await pdfDigest(document)!==key||await pdfDigest(pending)!==key)throw Error('PDF hashes do not match. Pending copy retained.');
 const latest=await(await context.pending.getFileHandle(key)).getFile(),mapped=await mappedPath(key,context);
 if(latest.size!==pending.size||latest.lastModified!==pending.lastModified||pathKey(mapped)!==pathKey(path))throw Error('Files changed during verification. Pending copy retained.');
 const current=await fileAt(context.app,mapped);if(current.size!==document.size||current.lastModified!==document.lastModified)throw Error('Organised PDF changed. Pending copy retained.');
 await context.pending.removeEntry(key);return {removed:true,bytes:pending.size};
}
export async function cleanPendingDuplicates(){return documentLock(async()=>{
 const context=await dirs(),result={removed:0,bytes:0,retained:[]};
 for await(const [key,handle]of context.pending.entries()){
  if(handle.kind!=='file'||!pdfname.test(key))continue;
  try{const cleaned=await cleanupPendingKey(key,context);if(cleaned.removed){result.removed++;result.bytes+=cleaned.bytes}else result.retained.push(key+': no verified organised copy.')}
  catch(error){result.retained.push(key+': '+error.message)}
 }
 return result;
})}
function referencedDocuments(rows){
 const refs=new Map();
 const ordered=[...rows].sort((a,b)=>Number(!!a.deletedAt)-Number(!!b.deletedAt)||b.updated.localeCompare(a.updated)||a.id.localeCompare(b.id));
 for(const row of ordered)for(const variant of row._variants||[{record:row}]){
  const r=variant.record;
  if(!refs.has(r.file))refs.set(r.file,{...r});
  for(const h of r.history||[])if(!refs.has(h.file))refs.set(h.file,{...r,revision:h.revision||'',file:h.file});
 }
 return refs;
}
export async function previewDocumentNames(){return documentLock(async()=>{
 const context=await dirs(),listing=await folderList();if(listing.warnings.length)throw Error('Resolve Library health warnings before updating document names.');
 const claims=new Map(),changes=[],unchanged=[];
 for(const [key,record]of referencedDocuments(listing.records)){
  const old=await mappedPath(key,context),blob=await folderPDF(key);if(await pdfDigest(blob)!==key)throw Error('PDF integrity check failed for '+record.name+'. No names were changed.');
  const path=await chooseDocumentPath(record,key,context,claims);
  if(old&&pathKey(old)===pathKey(path)){unchanged.push(key);continue}
  changes.push({key,name:record.name,from:old||['_system','pending-pdfs',key],to:path});
 }
 return {created:new Date().toISOString(),changes,unchanged:unchanged.length};
})}
export async function applyDocumentNames(plan){return documentLock(async()=>{
 const context=await dirs(),batch=crypto.randomUUID(),system=await context.app.getDirectoryHandle('_system',{create:true}),recoveryRoot=await system.getDirectoryHandle('recovery',{create:true}),recovery=await recoveryRoot.getDirectoryHandle(batch,{create:true}),result={renamed:0,skipped:[],recoveryPath:`_system/recovery/${batch}`};
 await writeNew(recovery,'rename-plan.json',JSON.stringify(plan,null,2));
 await writeNew(recovery,'README.txt',`SDS Desk document-name update\n============================\nCreated: ${new Date().toISOString()}\nThe rename-plan.json file records original and proposed PDF locations.\nEach PDF is copied and checked before its link is updated. The old copy is removed only after the new link is verified.\nRecord IDs, history and Trash status are unchanged. Download a ZIP backup after completion.\n`);
 for(const change of plan.changes){
  try{
   if(!pdfname.test(change.key)||!Array.isArray(change.to)||change.to.length!==3||change.to[0]!=='documents'||change.to.some(p=>typeof p!=='string'||!p||p==='.'||p==='..'||/[\\/\x00-\x1f]/.test(p)))throw Error('Invalid target path.');
   const actual=await mappedPath(change.key,context),old=actual||['_system','pending-pdfs',change.key];
   if(pathKey(old)!==pathKey(change.from))throw Error('The PDF link changed after preview.');
   const source=await fileAt(context.app,old);if(await pdfDigest(source)!==change.key)throw Error('Source PDF no longer matches its identifier.');
   await copyVerifiedPDF(context,change.key,change.to,source);await publishPDFMap(context,change.key,change.to);result.renamed++;
   if(actual&&pathKey(old)!==pathKey(change.to)){
    const previous=await fileAt(context.app,old);
    if(previous.size!==source.size||previous.lastModified!==source.lastModified||await pdfDigest(previous)!==change.key)throw Error('The old PDF changed and was retained.');
    const oldDir=await context.documents.getDirectoryHandle(old[1]);await oldDir.removeEntry(old[2]);try{await context.documents.removeEntry(old[1])}catch{}
   }
  }catch(error){result.skipped.push(change.name+': '+error.message)}
 }
 await writeNew(recovery,'result.json',JSON.stringify(result,null,2));await ensureLibraryGuide(context.app);result.indexRebuilt=await rebuildFolderIndex();return result;
})}
export async function organiseExistingPDFs(){const list=await folderList();let count=0;for(const row of list.records){for(const v of row._variants||[{record:row}]){const r=v.record;await organisePDF(r);count++;for(const h of r.history||[])await organisePDF({...r,revision:h.revision||''},h.file)}}await rebuildFolderIndex();return count}
export async function folderSave(input,action='save',{deferIndex=false}={}){
 const {records}=await dirs(),id=input.id||crypto.randomUUID();if(!uuid.test(id))throw Error('Invalid record ID');let old;
 try{old=await readRecord(records,id,{strict:true})}catch(e){if(e.name!=='NotFoundError')throw e}
 if(old&&JSON.stringify(input._heads||[])!==JSON.stringify(old._heads))throw Error('This record has changed in the folder. Reopen it to review the newest version.');
 if(old?._conflict&&!input._resolveConflict)throw Error('Conflicting edits exist. Open the record, compare versions, and explicitly confirm resolution.');
 let record;
 if(action==='trash'||action==='untrash'){if(!old)throw Error('Record missing');record={...old};if(action==='trash')record.deletedAt=new Date().toISOString();else delete record.deletedAt}
 else{if(old?.deletedAt)throw Error('Restore this record before editing.');record={...input,id};record.history=old?.history||input.history||[];if(old&&old.file!==input.file)record.history=[...record.history,{file:old.file,revision:old.revision,replaced:new Date().toISOString()}]}
 if(old?._conflict&&action==='save'){const seen=new Set([record.file,...(record.history||[]).map(h=>h.file)]);for(const variant of old._variants){const v=variant.record;if(!seen.has(v.file)){record.history=[...(record.history||[]),{file:v.file,revision:v.revision||'',replaced:new Date().toISOString()}];seen.add(v.file)}}}
 record.updated=new Date().toISOString();for(const key of ['_heads','_conflict','_variants','_resolveConflict','_pdfPath'])delete record[key];
 if(!record.name?.trim())throw Error('Product name is required');await organisePDF(record);
 const event={format:'sds-record-v1',parents:old?._heads||[],record};const dir=await records.getDirectoryHandle(id,{create:true});await writeRevision(dir,id,event);try{await documentLock(async()=>cleanupPendingKey(record.file,await dirs()))}catch{}if(!deferIndex)await rebuildFolderIndex();return record;
}
export async function folderExport(){const {records}=await folderList(),keys=new Set();for(const r of records){for(const v of r._variants||[{record:r}]){keys.add(v.record.file);for(const h of v.record.history||[])keys.add(h.file)}}const files=[],names=[];for(const key of keys){files.push(await folderPDF(key));names.push(key)}return {records,files,keys:names}}
export async function folderRestore(rows,pdfs){for(const [key,blob]of pdfs)await folderPutPDF(key,blob);const existing=new Set((await folderList()).records.map(r=>r.id));for(const row of rows)if(!existing.has(row.id)){const variants=row._variants?.length?row._variants.map(v=>v.record):[row];for(const record of variants){const {records}=await dirs(),dir=await records.getDirectoryHandle(row.id,{create:true});const clean={...record};for(const k of ['_heads','_conflict','_variants','_pdfPath'])delete clean[k];await organisePDF(clean);for(const h of clean.history||[])await organisePDF({...clean,revision:h.revision||''},h.file);await writeRevision(dir,row.id,{format:'sds-record-v1',parents:[],record:clean})}}await rebuildFolderIndex()}

export async function rebuildFolderIndex(){
 try{
  const listing=await folderList(),index={format:'sds-desk-index-v1',note:'Derived summary only. The records directory is authoritative; refresh in SDS Desk after synchronisation.',records:await Promise.all(listing.records.map(async r=>{const out={};for(const k of ['id','name','supplier','code','concentration','cas','lab','revision','review','expiry','file','updated','deletedAt'])if(r[k]!==undefined)out[k]=r[k];out.pdf=await pdfRelativePath(r.file);out.recordDirectory='records/'+r.id;out.conflictingEdits=!!r._conflict;return out})).then(rows=>rows.sort((a,b)=>a.id.localeCompare(b.id)))};
  const app=await(await requireFolder()).getDirectoryHandle('SDS-Desk');await ensureLibraryGuide(app);const text=JSON.stringify(index,null,2);let previous='';try{previous=await(await(await app.getFileHandle('index.json')).getFile()).text()}catch(e){if(e.name!=='NotFoundError')throw e}if(previous!==text)await writeNew(app,'index.json',text);indexWarning='';return true;
 }catch{indexWarning='Records are preserved, but the shared summary index could not be refreshed. Check folder permissions and select Check for updates.';return false}
}

// Snapshot every file, including superseded revisions and pending uploads.
export async function folderBackupFiles(){const {app}=await dirs(),files=new Map();async function walk(dir,prefix){for await(const [name,h]of dir.entries()){const path=prefix+name;if(h.kind==='directory')await walk(h,path+'/');else files.set(path,await h.getFile())}}await walk(app,'');return files}
export async function folderRestoreFiles(files){
 const {app}=await dirs();
 // Preflight all collisions before writing. Never overwrite a different local file.
 const missing=[];
 for(const [path,blob]of files){const parts=path.split('/');try{const old=await fileAt(app,parts);const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))).join(',');if(await digest(old)!==await digest(blob)){if(path==='index.json'||path==='README.txt')continue;throw Error('Backup conflicts with an existing file: '+path+'. Restore into an empty connected folder instead.')}}catch(e){if(e.name!=='NotFoundError')throw e;missing.push([parts,blob])}}
 // Publish documents before metadata and record revisions.
 missing.sort((a,b)=>Number(a[0][0]==='records')-Number(b[0][0]==='records'));
 for(const [parts,blob]of missing){let dir=app;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});await writeNew(dir,parts.at(-1),blob)}
 await rebuildFolderIndex();
}
