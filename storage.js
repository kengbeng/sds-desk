import {APP_VERSION} from './version.js';
import {folderState,folderList,folderPDF,folderPutPDF,folderSave,folderExport,folderRestore,folderBackupFiles,folderRestoreFiles,documentPath} from './folder.js';
import {extractFields,layoutText} from './extract.js';
import * as pdfjs from './vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const opened=new Promise((resolve,reject)=>{const q=indexedDB.open('sds-desk-browser',1);q.onupgradeneeded=()=>{q.result.createObjectStore('records',{keyPath:'id'});q.result.createObjectStore('pdfs')};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
async function transaction(stores,mode,fn){const db=await opened;return new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let result;try{result=fn(tx)}catch(e){tx.abort();reject(e);return}tx.oncomplete=()=>resolve(typeof result==='function'?result():result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Save cancelled.'))})}
async function get(store,key){return transaction([store],'readonly',tx=>{let value;const q=tx.objectStore(store).get(key);q.onsuccess=()=>value=q.result;return()=>value})}
async function all(store){return transaction([store],'readonly',tx=>{let value;const q=tx.objectStore(store).getAll();q.onsuccess=()=>value=q.result;return()=>value})}
export async function pdfURL(key){const blob=(await folderState()).configured?await folderPDF(key):await get('pdfs',key);if(!blob)throw Error('PDF missing. Restore a backup containing this file.');return URL.createObjectURL(blob)}
export async function api(path,options={}){
 const folderMode=(await folderState()).configured;
 if(folderMode&&path==='/api/records')return folderList();
 if(folderMode&&['/api/trash','/api/untrash'].includes(path))return folderSave(JSON.parse(options.body),path==='/api/trash'?'trash':'untrash');
 if(path==='/api/records')return {records:(await all('records')).sort((a,b)=>b.updated.localeCompare(a.updated)),storage:'This browser / this device',version:APP_VERSION};
 if(path==='/api/import'){
  const file=options.body, bytes=new Uint8Array(await file.arrayBuffer());
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Select a valid PDF.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')+'.pdf';
  let doc,pages=[],warnings=[],fields={},evidence={};
  try{
   doc=await pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href}).promise;
   if(doc.numPages>300)throw Error('PDF exceeds 300 pages.');
   for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i),content=await page.getTextContent();const text=layoutText(content.items);
    pages.push({page:i,text});if(text.trim().length<30)warnings.push(`Page ${i} has little readable text. Scanned PDFs need manual entry in this version.`);
   }
   const extracted=extractFields(pages);({fields,evidence}=extracted);warnings.push(...extracted.warnings);
  }catch(e){if(e.name==='PasswordException')throw Error('Password-protected PDF. Select an unlocked copy.');throw e}finally{await doc?.destroy()}
  if(folderMode)await folderPutPDF(hash,file);else await transaction(['pdfs'],'readwrite',tx=>tx.objectStore('pdfs').put(file,hash));
  return {file:hash,fields,evidence,pages,warnings,cas_candidates:[...new Set(pages.map(p=>p.text).join('\n').match(/\b\d{2,7}-\d{2}-\d\b/g)||[])],message:'Draft extraction. Verify every value and date against the supplier PDF.'};
 }
 if(path==='/api/trash'||path==='/api/untrash'){
  const {id,updated}=JSON.parse(options.body);let failure;
  await transaction(['records'],'readwrite',tx=>{const st=tx.objectStore('records'),q=st.get(id);q.onsuccess=()=>{const r=q.result;if(!r){failure='Record no longer exists.';return}if(r.updated!==updated){failure='Record changed elsewhere. Refresh and retry.';return}if(path==='/api/trash')r.deletedAt=new Date().toISOString();else delete r.deletedAt;r.updated=new Date().toISOString();st.put(r)}});
  if(failure)throw Error(failure);return {ok:true};
 }
 if(path==='/api/save'){
  const r=JSON.parse(options.body);if(!r.name?.trim())throw Error('Product name is required.');if(!folderMode&&!await get('pdfs',r.file))throw Error('Select a PDF first.');
  for(const key of ['revision','review','expiry'])if(r[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(r[key])||isNaN(Date.parse(r[key]))))throw Error('Invalid date.');
  if(folderMode)return folderSave(r);
  r.id=r.id||crypto.randomUUID();let failure=null;
  await transaction(['records'],'readwrite',tx=>{const st=tx.objectStore('records'),q=st.get(r.id);q.onsuccess=()=>{const old=q.result;if(old?.deletedAt){failure='Record is in Trash. Restore it before editing.';return}if(old&&old.updated!==r.updated){failure='Record changed in another window. Reopen it before saving.';return}r.history=old?.history||[];if(old&&old.file!==r.file)r.history=[...r.history,{file:old.file,revision:old.revision,replaced:new Date().toISOString()}];r.updated=new Date().toISOString();st.put(r)}});
  if(failure)throw Error(failure);return r;
 }
 throw Error('Unknown operation');
}
export async function backup(){
 const folderMode=(await folderState()).configured;
 const data=folderMode?await folderExport():await transaction(['records','pdfs'],'readonly',tx=>{let records,files,keys;const a=tx.objectStore('records').getAll(),b=tx.objectStore('pdfs').getAll(),c=tx.objectStore('pdfs').getAllKeys();a.onsuccess=()=>records=a.result;b.onsuccess=()=>files=b.result;c.onsuccess=()=>keys=c.result;return()=>({records,files,keys})});
 const zip=new JSZip(),paths={};let files=folderMode?await folderBackupFiles():new Map();
 if(folderMode){for(const key of data.keys){const {pdfRelativePath}=await import('./folder.js');paths[key]=await pdfRelativePath(key)}}
 else{
  for(let i=0;i<data.keys.length;i++){const key=data.keys[i],r=data.records.find(r=>r.file===key)||(data.records.find(r=>(r.history||[]).some(h=>h.file===key)));const h=r?.history?.find(h=>h.file===key);const path=r?documentPath({...r,revision:h?h.revision:r.revision},key).join('/'):'_system/pending-pdfs/'+key;paths[key]=path;files.set(path,data.files[i]);files.set('_system/pdf-index/'+key+'.json',new Blob([JSON.stringify({format:'sds-pdf-path-v1',key,path:path.split('/')})]))}
  for(const r of data.records)files.set('records/'+r.id+'/v-'+crypto.randomUUID()+'.json',new Blob([JSON.stringify({format:'sds-record-v1',parents:[],record:r})]));
  files.set('index.json',new Blob([JSON.stringify({format:'sds-desk-index-v1',records:data.records.map(r=>({...r,pdf:paths[r.file]}))})]));
 }
 for(const [path,blob]of files)zip.file('SDS-Desk/'+path,await blob.arrayBuffer());
 zip.file('backup-manifest.json',JSON.stringify({format:'sds-desk-folder-backup',version:1,created:new Date().toISOString(),records:data.records,pdfs:paths},null,2));
 const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:1}});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SDS-Desk-backup-'+new Date().toISOString().slice(0,10)+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export async function restore(file){
 if(file.size>500*1024*1024)throw Error('Backup exceeds 500 MB.');
 const zip=await JSZip.loadAsync(file,{checkCRC32:true});const files=new Map();let total=0,count=0;
 for(const [name,entry]of Object.entries(zip.files)){
  if(entry.unsafeOriginalName&&entry.unsafeOriginalName!==name)throw Error('Unsafe ZIP path.');
  if(name.split('/').some(p=>p==='..'||p==='.'||/[\\:\x00-\x1f]/.test(p))||name.startsWith('/'))throw Error('Unsafe ZIP path.');
  if(entry.dir)continue;if(++count>20000)throw Error('Too many files in backup.');
  if(name!=='backup-manifest.json'&&!name.startsWith('SDS-Desk/'))throw Error('Unexpected backup file: '+name);
  if((entry._data?.uncompressedSize||0)+total>500*1024*1024)throw Error('Expanded backup exceeds 500 MB.');const bytes=await entry.async('uint8array');total+=bytes.length;if(total>500*1024*1024)throw Error('Expanded backup exceeds 500 MB.');
  files.set(name,new Blob([bytes]));
 }
 const manifest=files.get('backup-manifest.json');if(!manifest)throw Error('Missing backup manifest. Use a ZIP exported by SDS Desk.');
 const data=JSON.parse(await manifest.text());if(data.format!=='sds-desk-folder-backup'||data.version!==1||!Array.isArray(data.records)||!data.pdfs||typeof data.pdfs!=='object')throw Error('Unsupported backup format.');
 const pdfs=new Map();for(const [key,path]of Object.entries(data.pdfs)){if(!/^[a-f0-9]{64}\.pdf$/.test(key)||typeof path!=='string')throw Error('Invalid PDF entry.');const blob=files.get('SDS-Desk/'+path);if(!blob)throw Error('Missing PDF: '+path);const bytes=new Uint8Array(await blob.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF content.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')+'.pdf';if(hash!==key)throw Error('PDF integrity check failed.');pdfs.set(key,new Blob([bytes],{type:'application/pdf'}))}
 const rows=[];for(const source of data.records){if(!/^[a-f0-9-]{36}$/.test(source.id)||typeof source.name!=='string'||!source.name.trim())throw Error('Invalid product record.');const r={id:source.id};if(source._variants)r._variants=source._variants.map(v=>({record:v.record}));for(const k of ['name','supplier','code','concentration','cas','lab','revision','review','expiry','notes','updated','file'])r[k]=String(source[k]||'').slice(0,10000);if(source.deletedAt)r.deletedAt=String(source.deletedAt);r.updated=r.updated||new Date().toISOString();r.history=(source.history||[]).map(h=>({file:String(h.file),revision:String(h.revision||''),replaced:String(h.replaced||'')}));for(const v of r._variants||[]){if(v.record?.id!==r.id||typeof v.record.name!=='string'||typeof v.record.updated!=='string'||!Array.isArray(v.record.history||[]))throw Error('Invalid conflict variant.');for(const f of [v.record.file,...(v.record.history||[]).map(h=>h.file)])if(!pdfs.has(f))throw Error('Missing conflict PDF.')}for(const f of [r.file,...r.history.map(h=>h.file)])if(!pdfs.has(f))throw Error('Backup is missing a referenced PDF.');for(const k of ['review','revision','expiry'])if(r[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(r[k]))throw Error('Invalid backup date.');rows.push(r)}
 if((await folderState()).configured){await folderRestoreFiles(new Map([...files].filter(([name])=>name.startsWith('SDS-Desk/')).map(([name,blob])=>[name.slice(9),blob])));return}
 await transaction(['records','pdfs'],'readwrite',tx=>{for(const [key,blob]of pdfs)tx.objectStore('pdfs').put(blob,key);for(const r of rows){const st=tx.objectStore('records'),q=st.get(r.id);q.onsuccess=()=>{if(!q.result)st.put(r)}}});
}
