// A provider-neutral local folder store. Immutable revisions avoid overwriting synced edits.
const uuid=/^[a-f0-9-]{36}$/i,pdfname=/^[a-f0-9]{64}\.pdf$/;
const handles=new Promise((resolve,reject)=>{const q=indexedDB.open('sds-folder-settings',1);q.onupgradeneeded=()=>q.result.createObjectStore('settings');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
let folder,configured=false,loaded=false,lastWarnings=[],indexWarning='';
async function setting(value,write=false){const db=await handles;return new Promise((resolve,reject)=>{const tx=db.transaction('settings',write?'readwrite':'readonly'),st=tx.objectStore('settings');let result;const q=write?st.put(value,'folder'):st.get('folder');q.onsuccess=()=>result=q.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error)})}
export async function folderState(){if(!loaded){folder=await setting();configured=!!folder;loaded=true}return {configured,name:folder?.name,supported:'showDirectoryPicker'in window}}
async function requireFolder(){await folderState();if(!folder)throw Error('No storage folder connected.');if(await folder.queryPermission({mode:'readwrite'})!=='granted')throw Error('Folder access needs permission. Click Reconnect folder.');return folder}
export async function connectFolder(reconnect=false){
 if(!('showDirectoryPicker'in window))throw Error('Folder access is unavailable here. Open this app in desktop Chrome or Edge.');
 await folderState();let chosen;
 if(reconnect&&folder){if(await folder.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder access was not granted.');chosen=folder}
 else{try{chosen=await window.showDirectoryPicker({id:'sds-storage',mode:'readwrite'})}catch(e){if(['SecurityError','NotAllowedError'].includes(e.name))throw Error('This browser context blocks folder access. Open the app directly in desktop Chrome or Edge, then click Connect folder.');throw e}}
 // Establish the app-owned subfolder before changing storage mode.
 const app=await chosen.getDirectoryHandle('SDS-Desk',{create:true});await app.getDirectoryHandle('documents',{create:true});await app.getDirectoryHandle('records',{create:true});
 await setting(chosen,true);folder=chosen;configured=true;loaded=true;await rebuildFolderIndex();return folderState();
}
export async function disconnectFolder(){await setting(null,true);folder=null;configured=false;loaded=true}
async function dirs(){const root=await requireFolder();const app=await root.getDirectoryHandle('SDS-Desk',{create:true});const system=await app.getDirectoryHandle('_system',{create:true});return {app,documents:await app.getDirectoryHandle('documents',{create:true}),pending:await system.getDirectoryHandle('pending-pdfs',{create:true}),maps:await system.getDirectoryHandle('pdf-index',{create:true}),records:await app.getDirectoryHandle('records',{create:true})}}
async function writeNew(dir,name,blob){const handle=await dir.getFileHandle(name,{create:true}),w=await handle.createWritable();try{await w.write(blob);await w.close()}catch(e){try{await w.abort()}catch{}throw e}}
export function selectRevisions(events){const parents=new Set(events.flatMap(e=>e.parents||[])),tips=events.filter(e=>!parents.has(e.key)).sort((a,b)=>b.record.updated.localeCompare(a.record.updated)||b.key.localeCompare(a.key));if(!tips.length)return null;return {...tips[0].record,_heads:tips.map(e=>e.key).sort(),_conflict:tips.length>1,_variants:tips.map(e=>({key:e.key,record:e.record}))}}
function validateRecord(r,id){if(!r||r.id!==id||!uuid.test(r.id)||typeof r.name!=='string'||!pdfname.test(r.file)||typeof r.updated!=='string')throw Error('Invalid record revision');return r}
async function readRecord(parent,id){const dir=await parent.getDirectoryHandle(id),events=[];for await(const [name,h]of dir.entries()){if(h.kind!=='file'||!/^v-[a-f0-9-]{36}\.json$/i.test(name))continue;try{const file=await h.getFile();if(file.size>2000000)throw Error('Oversized record');const e=JSON.parse(await file.text());validateRecord(e.record,id);if(!Array.isArray(e.parents)||e.parents.some(v=>!/^v-[a-f0-9-]{36}\.json$/i.test(v)))throw Error('Invalid parents');events.push({...e,key:name})}catch{lastWarnings.push('An unreadable record version was skipped. Wait for sync to finish and refresh.')}}return selectRevisions(events)}
export async function folderList(){const {records}=await dirs();lastWarnings=[];const rows=[];for await(const [id,h]of records.entries()){if(h.kind==='directory'&&uuid.test(id)){const row=await readRecord(records,id);if(row)rows.push(row)}}if(indexWarning)lastWarnings.push(indexWarning);return {records:rows.sort((a,b)=>b.updated.localeCompare(a.updated)),storage:`Connected folder: ${folder.name} / SDS-Desk · Cloud sync handled by your desktop sync app`,warnings:[...new Set(lastWarnings)]}}
export function safePart(value,fallback='Unknown',limit=54){let out=String(value||'').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^[. -]+|[. -]+$/g,'').slice(0,limit).replace(/[. -]+$/g,'');if(!out)out=fallback;if(/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(out))out='_'+out;return out}
export function documentPath(record,key=record.file){const product=safePart(record.name,'Unnamed-product',32),supplier=safePart(record.supplier,'Unknown-supplier',22),cas=(record.cas||'').match(/\b\d{2,7}-\d{2}-\d\b/)?.[0];const date=/^\d{4}-\d{2}-\d{2}$/.test(record.revision||'')?record.revision:'Undated';return ['documents',product+(cas?'__CAS-'+cas:''),`${product}__${supplier}__SDS-${date}__${key.slice(0,12)}.pdf`]}
async function mappedPath(key,context){const {maps}=context||await dirs();try{const file=await(await maps.getFileHandle(key+'.json')).getFile();if(file.size>20000)throw Error('Invalid PDF path map');const data=JSON.parse(await file.text()),parts=data.path;if(!Array.isArray(parts)||parts.length!==3||parts[0]!=='documents'||parts.some(v=>typeof v!=='string'||!v||v==='.'||v==='..'||/[\\/\x00-\x1f]/.test(v))||!parts[2].endsWith('.pdf'))throw Error('Invalid PDF path map');return parts}catch(e){if(e.name==='NotFoundError')return null;throw e}}
async function fileAt(app,parts){let dir=app;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);return(await dir.getFileHandle(parts.at(-1))).getFile()}
export async function pdfRelativePath(key){if(!pdfname.test(key))throw Error('Invalid PDF key');const d=await dirs(),parts=await mappedPath(key,d);if(parts)return parts.join('/');try{await d.pending.getFileHandle(key);return '_system/pending-pdfs/'+key}catch(e){if(e.name!=='NotFoundError')throw e}return '_system/pending-pdfs/'+key}
export async function folderPDF(key){if(!pdfname.test(key))throw Error('Invalid PDF filename');const d=await dirs(),path=await mappedPath(key,d);if(path){try{return await fileAt(d.app,path)}catch(e){if(e.name!=='NotFoundError')throw e}}
 for(const dir of [d.pending]){try{return await(await dir.getFileHandle(key)).getFile()}catch(e){if(e.name!=='NotFoundError')throw e}}throw Error('PDF not available locally. Wait for cloud sync and keep the shared folder available offline.')}
export async function folderPutPDF(key,blob){if(!pdfname.test(key))throw Error('Invalid PDF filename');try{const existing=await folderPDF(key);if(existing.size===blob.size)return}catch(e){if(e.name!=='NotFoundError'&&!e.message.startsWith('PDF not available'))throw e}const {pending}=await dirs();await writeNew(pending,key,blob)}
export async function organisePDF(record,key=record.file){
 if(!pdfname.test(key))throw Error('Invalid PDF key');const d=await dirs(),existing=await mappedPath(key,d);
 // Keep an established readable path stable when users edit metadata later.
 if(existing){try{await fileAt(d.app,existing);return existing.join('/')}catch(e){if(e.name!=='NotFoundError')throw e}}
 const blob=await folderPDF(key),path=documentPath(record,key);const product=await d.documents.getDirectoryHandle(path[1],{create:true});await writeNew(product,path[2],blob);
 // A content check precedes publishing the path map. Unchanged logical IDs keep record links intact.
 const verified=await(await product.getFileHandle(path[2])).getFile();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await verified.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('')+'.pdf';if(digest!==key)throw Error('PDF integrity check failed while organising files.');
 await writeNew(d.maps,key+'.json',JSON.stringify({format:'sds-pdf-path-v1',key,path},null,2));return path.join('/');
}
export async function organiseExistingPDFs(){const list=await folderList();let count=0;for(const row of list.records){for(const v of row._variants||[{record:row}]){const r=v.record;await organisePDF(r);count++;for(const h of r.history||[])await organisePDF({...r,revision:h.revision||''},h.file)}}await rebuildFolderIndex();return count}
export async function folderSave(input,action='save'){
 const {records}=await dirs(),id=input.id||crypto.randomUUID();if(!uuid.test(id))throw Error('Invalid record ID');let old;
 try{old=await readRecord(records,id)}catch(e){if(e.name!=='NotFoundError')throw e}
 if(old&&JSON.stringify(input._heads||[])!==JSON.stringify(old._heads))throw Error('This record has changed in the folder. Reopen it to review the newest version.');
 if(old?._conflict&&!input._resolveConflict)throw Error('Conflicting edits exist. Open the record, compare versions, and explicitly confirm resolution.');
 let record;
 if(action==='trash'||action==='untrash'){if(!old)throw Error('Record missing');record={...old};if(action==='trash')record.deletedAt=new Date().toISOString();else delete record.deletedAt}
 else{if(old?.deletedAt)throw Error('Restore this record before editing.');record={...input,id};record.history=old?.history||input.history||[];if(old&&old.file!==input.file)record.history=[...record.history,{file:old.file,revision:old.revision,replaced:new Date().toISOString()}]}
 if(old?._conflict&&action==='save'){const seen=new Set([record.file,...(record.history||[]).map(h=>h.file)]);for(const variant of old._variants){const v=variant.record;if(!seen.has(v.file)){record.history=[...(record.history||[]),{file:v.file,revision:v.revision||'',replaced:new Date().toISOString()}];seen.add(v.file)}}}
 record.updated=new Date().toISOString();for(const key of ['_heads','_conflict','_variants','_resolveConflict','_pdfPath'])delete record[key];
 if(!record.name?.trim())throw Error('Product name is required');await organisePDF(record);
 const event={format:'sds-record-v1',parents:old?._heads||[],record};const dir=await records.getDirectoryHandle(id,{create:true});await writeNew(dir,'v-'+crypto.randomUUID()+'.json',JSON.stringify(event,null,2));await rebuildFolderIndex();return record;
}
export async function folderExport(){const {records}=await folderList(),keys=new Set();for(const r of records){for(const v of r._variants||[{record:r}]){keys.add(v.record.file);for(const h of v.record.history||[])keys.add(h.file)}}const files=[],names=[];for(const key of keys){files.push(await folderPDF(key));names.push(key)}return {records,files,keys:names}}
export async function folderRestore(rows,pdfs){for(const [key,blob]of pdfs)await folderPutPDF(key,blob);const existing=new Set((await folderList()).records.map(r=>r.id));for(const row of rows)if(!existing.has(row.id)){const variants=row._variants?.length?row._variants.map(v=>v.record):[row];for(const record of variants){const {records}=await dirs(),dir=await records.getDirectoryHandle(row.id,{create:true});const clean={...record};for(const k of ['_heads','_conflict','_variants','_pdfPath'])delete clean[k];await organisePDF(clean);for(const h of clean.history||[])await organisePDF({...clean,revision:h.revision||''},h.file);await writeNew(dir,'v-'+crypto.randomUUID()+'.json',JSON.stringify({format:'sds-record-v1',parents:[],record:clean}))}}await rebuildFolderIndex()}

export async function rebuildFolderIndex(){
 try{
  const listing=await folderList(),index={format:'sds-desk-index-v1',note:'Derived summary only. The records directory is authoritative; refresh in SDS Desk after synchronisation.',records:await Promise.all(listing.records.map(async r=>{const out={};for(const k of ['id','name','supplier','code','concentration','cas','lab','revision','review','expiry','file','updated','deletedAt'])if(r[k]!==undefined)out[k]=r[k];out.pdf=await pdfRelativePath(r.file);out.recordDirectory='records/'+r.id;out.conflictingEdits=!!r._conflict;return out})).then(rows=>rows.sort((a,b)=>a.id.localeCompare(b.id)))};
  const app=await(await requireFolder()).getDirectoryHandle('SDS-Desk'),text=JSON.stringify(index,null,2);let previous='';try{previous=await(await(await app.getFileHandle('index.json')).getFile()).text()}catch(e){if(e.name!=='NotFoundError')throw e}if(previous!==text)await writeNew(app,'index.json',text);indexWarning='';return true;
 }catch{indexWarning='Records are preserved, but the shared summary index could not be refreshed. Check folder permissions and select Check for updates.';return false}
}

// Snapshot every file, including superseded revisions and pending uploads.
export async function folderBackupFiles(){const {app}=await dirs(),files=new Map();async function walk(dir,prefix){for await(const [name,h]of dir.entries()){const path=prefix+name;if(h.kind==='directory')await walk(h,path+'/');else files.set(path,await h.getFile())}}await walk(app,'');return files}
export async function folderRestoreFiles(files){
 const {app}=await dirs();
 // Preflight all collisions before writing. Never overwrite a different local file.
 const missing=[];
 for(const [path,blob]of files){const parts=path.split('/');try{const old=await fileAt(app,parts);const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))).join(',');if(await digest(old)!==await digest(blob)){if(path==='index.json')continue;throw Error('Backup conflicts with an existing file: '+path+'. Restore into an empty connected folder instead.')}}catch(e){if(e.name!=='NotFoundError')throw e;missing.push([parts,blob])}}
 // Publish documents before metadata and record revisions.
 missing.sort((a,b)=>Number(a[0][0]==='records')-Number(b[0][0]==='records'));
 for(const [parts,blob]of missing){let dir=app;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});await writeNew(dir,parts.at(-1),blob)}
 await rebuildFolderIndex();
}
