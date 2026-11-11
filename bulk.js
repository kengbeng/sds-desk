import {api} from './storage.js';
import {ask,notice} from './dialogs.js';
export function initBulk({getRecords,getVisible,load,isBusy,setBusy,getImportLocation}){
 const $=s=>document.querySelector(s),selected=new Set();
 const toolbar=document.createElement('div');toolbar.className='bulk-toolbar';toolbar.hidden=true;
 toolbar.innerHTML='<strong id="selectionCount" aria-live="polite"></strong><button id="bulkEdit">Edit selected</button><button id="bulkTrash" class="danger">Move to Trash</button><button id="bulkRestore">Restore selected</button><button id="clearSelection">Clear selection</button>';
 $('.tablewrap').before(toolbar);
 const heading=document.querySelector('thead th');heading.insertAdjacentHTML('afterbegin','<input id="selectAll" type="checkbox" aria-label="Select all visible records"> ');
 const importer=document.createElement('button');importer.textContent='Bulk import';$('#add').before(importer);
 const picker=document.createElement('input');picker.type='file';picker.accept='.pdf,application/pdf';picker.multiple=true;picker.hidden=true;document.body.append(picker);
 const dialog=document.createElement('dialog');dialog.className='bulk-dialog';dialog.setAttribute('aria-labelledby','bulkTitle');
 const fields=[['supplier','Supplier / manufacturer','text'],['lab','Location','text'],['review','Review due date','date'],['expiry','Explicit expiry date','date'],['notes','Notes','text']];
 dialog.innerHTML='<form id="bulkForm"><div class="dialoghead"><h2 id="bulkTitle">Edit selected records</h2><button type="button" id="bulkClose" aria-label="Close bulk edit">✕</button></div><div class="settings-body"><p id="bulkTarget"></p><p>Tick each field to change. A ticked field with an empty value clears that field for all selected records.</p>'+fields.map(([key,label,type])=>`<div class="bulk-field"><label><input type="checkbox" data-field="${key}"> Change ${label}</label><input name="${key}" type="${type}" aria-label="${label}" disabled></div>`).join('')+'<p id="bulkError" role="status"></p></div><div class="dialogfoot"><button type="button" id="bulkCancel">Cancel</button><button class="primary" type="submit">Apply changes</button></div></form>';
 document.body.append(dialog);let targets=[];
 function update(){
  const visible=getVisible(),ids=new Set(visible.map(r=>r.id));for(const id of selected)if(!ids.has(id))selected.delete(id);
  const rows=[...$('#rows').children];for(const row of rows){const id=row.querySelector('[data-id],[data-restore]')?.dataset;const key=id?.id||id?.restore;if(!key)continue;let box=row.querySelector('[data-select]');if(!box){box=document.createElement('input');box.type='checkbox';box.dataset.select=key;box.setAttribute('aria-label','Select '+(visible.find(r=>r.id===key)?.name||'record'));row.firstElementChild.prepend(box)}box.checked=selected.has(key);row.classList.toggle('bulk-selected',box.checked)}
  toolbar.hidden=!selected.size;$('#selectionCount').textContent=`${selected.size} selected`;const trash=$('#filter').value==='trash';$('#bulkEdit').hidden=$('#bulkTrash').hidden=trash;$('#bulkRestore').hidden=!trash;
  const all=$('#selectAll');all.checked=!!visible.length&&selected.size===visible.length;all.indeterminate=selected.size>0&&selected.size<visible.length;all.disabled=!visible.length||isBusy();
 }
 $('#rows').addEventListener('change',e=>{if(e.target.dataset.select){e.target.checked?selected.add(e.target.dataset.select):selected.delete(e.target.dataset.select);update()}});
 $('#selectAll').onchange=e=>{selected.clear();if(e.target.checked)for(const r of getVisible())selected.add(r.id);update()};$('#clearSelection').onclick=()=>{selected.clear();update()};
 async function run(rows,operation){setBusy(true);let count=0;const errors=[];try{for(const r of rows){try{await operation(r);selected.delete(r.id);count++}catch(e){errors.push(`${r.name}: ${e.message}`)}}await load()}finally{setBusy(false);update()}await notice(`${count} of ${rows.length} records updated.`+(errors.length?'\n'+errors.join('\n'):''))}
 function chosen(){return getVisible().filter(r=>selected.has(r.id)).map(r=>structuredClone(r))}
 async function move(restore){if(isBusy())return;const rows=chosen();if(!rows.length||!await ask(`${restore?'Restore':'Move to Trash'} ${rows.length} selected records? PDFs and history are retained.`))return;await run(rows,r=>api(restore?'/api/untrash':'/api/trash',{method:'POST',body:JSON.stringify({id:r.id,updated:r.updated,_heads:r._heads})}))}
 $('#bulkTrash').onclick=()=>move(false);$('#bulkRestore').onclick=()=>move(true);
 $('#bulkEdit').onclick=()=>{if(isBusy())return;targets=chosen();if(!targets.length)return;if(targets.some(r=>r._conflict))return notice('Resolve conflicting edits individually before bulk editing these records.');$('#bulkForm').reset();dialog.querySelectorAll('[name]').forEach(i=>i.disabled=true);$('#bulkError').textContent='';$('#bulkTarget').textContent=`Changes apply to ${targets.length} selected records.`;dialog.showModal()};
 $('#bulkClose').onclick=$('#bulkCancel').onclick=()=>dialog.close();dialog.onchange=e=>{if(e.target.dataset.field)$('#bulkForm').elements[e.target.dataset.field].disabled=!e.target.checked};
 $('#bulkForm').onsubmit=async e=>{e.preventDefault();if(isBusy())return;const patch=Object.fromEntries(new FormData(e.target));if(!Object.keys(patch).length){$('#bulkError').textContent='Select at least one field to change.';return}if(!await ask(`Apply these ${Object.keys(patch).length} field changes to ${targets.length} records? Existing values in these fields will be replaced.`))return;dialog.close();await run(targets,r=>api('/api/save',{method:'POST',body:JSON.stringify({...r,...patch})}))};
 const importDialog=document.createElement('dialog');importDialog.id='bulkImportDialog';importDialog.setAttribute('aria-labelledby','bulkImportTitle');
 importDialog.innerHTML='<div class="dialoghead"><h2 id="bulkImportTitle">Bulk import</h2><button id="bulkImportClose" aria-label="Close bulk import">✕</button></div><div class="settings-body"><div id="bulkDropzone" class="bulk-dropzone" tabindex="0" role="group" aria-label="Drop multiple SDS PDF files here"><strong>Drag and drop PDFs here</strong><span>Import one or more files. Each PDF must be 30 MB or less.</span><button type="button" id="bulkChooseFiles">Choose PDFs</button><small>Select multiple files in the file picker.</small></div><p>Creates a separate record for each PDF. PDFs already in this library are skipped, including records in Trash. Check extracted details against each original document after importing.</p><div id="bulkFileList" class="bulk-file-list" aria-label="Selected files"></div><p id="bulkImportStatus" role="status" aria-live="polite">No files selected.</p></div><div class="dialogfoot"><button id="bulkImportCancel">Cancel</button><button id="bulkImportStart" class="primary" disabled>Import PDFs</button></div>';
 document.body.append(importDialog);let pendingFiles=[],importing=false;
 const zone=$('#bulkDropzone'),status=$('#bulkImportStatus'),startButton=$('#bulkImportStart');
 const setStatus=message=>status.textContent=message;
 function selectFiles(files){
  if(importing||isBusy())return;
  pendingFiles=[...files];$('#bulkFileList').replaceChildren();
  for(const file of pendingFiles){const line=document.createElement('div');line.className='bulk-file';line.textContent=file.name;$('#bulkFileList').append(line)}
  const invalid=pendingFiles.filter(f=>(! /\.pdf$/i.test(f.name)&&f.type!=='application/pdf')||f.size>30*1024*1024);
  setStatus(pendingFiles.length?`${pendingFiles.length} file(s) selected.`+(invalid.length?` ${invalid.length} file(s) cannot be imported. Select PDFs of 30 MB or less.`:''):'No files selected.');
  startButton.disabled=!pendingFiles.length||!!invalid.length;startButton.textContent=pendingFiles.length?`Import ${pendingFiles.length} PDF${pendingFiles.length===1?'':'s'}`:'Import PDFs';
 }
 importer.onclick=()=>{if(isBusy())return;selectFiles([]);$('#bulkImportCancel').textContent='Cancel';importDialog.showModal()};
 $('#bulkChooseFiles').onclick=()=>{if(!importing&&!isBusy())picker.click()};
 picker.onchange=()=>{selectFiles(picker.files);picker.value=''};
 function closeImport(){if(!importing)importDialog.close()}
 $('#bulkImportClose').onclick=$('#bulkImportCancel').onclick=closeImport;
 importDialog.addEventListener('cancel',event=>{if(importing)event.preventDefault()});
 let dragDepth=0;
 for(const type of ['dragenter','dragover','dragleave','drop'])zone.addEventListener(type,event=>{
  event.preventDefault();event.stopPropagation();if(importing||isBusy())return;
  if(type==='dragenter'){dragDepth++;zone.classList.add('dragover')}
  if(type==='dragover')event.dataTransfer.dropEffect='copy';
  if(type==='dragleave'&&--dragDepth<=0)zone.classList.remove('dragover');
  if(type==='drop'){dragDepth=0;zone.classList.remove('dragover');selectFiles(event.dataTransfer.files)}
 });
 zone.addEventListener('keydown',event=>{if(event.target===zone&&['Enter',' '].includes(event.key)){event.preventDefault();$('#bulkChooseFiles').click()}});
 startButton.onclick=async()=>{
  if(importing||isBusy()||!pendingFiles.length||startButton.disabled)return;
  const files=[...pendingFiles];importing=true;setBusy(true);importer.disabled=true;startButton.disabled=true;$('#bulkChooseFiles').disabled=true;$('#bulkImportClose').disabled=true;$('#bulkImportCancel').disabled=true;zone.setAttribute('aria-busy','true');
  const known=new Set(getRecords().map(r=>r.file));let added=0,skipped=0;const errors=[];
  try{for(const [i,file]of files.entries()){
   importer.textContent=`Importing ${i+1} / ${files.length}…`;setStatus(`Importing ${i+1} of ${files.length}: ${file.name}`);
   try{if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')throw Error('Please choose a PDF.');if(file.size>30*1024*1024)throw Error('PDF exceeds 30 MB.');
    const d=await api('/api/import',{method:'POST',body:file});if(known.has(d.file)){skipped++;continue}
    await api('/api/save',{method:'POST',body:JSON.stringify({...d.fields,name:d.fields.name?.trim()||file.name.replace(/\.pdf$/i,''),file:d.file,lab:getImportLocation(),notes:'Bulk import: verify extracted details against the original PDF.'+(d.warnings.length?'\n'+d.warnings.join('\n'):'' )})});known.add(d.file);added++;
   }catch(e){errors.push(`${file.name}: ${e.message}`)}
  }await load();setStatus(`Imported ${added}; skipped ${skipped} duplicate(s); failed ${errors.length}. Review each imported record against its PDF.`+(errors.length?'\n'+errors.join('\n'):''));
  }catch(e){setStatus(`Import stopped: ${e.message}. ${added} record(s) were saved. Check the library before retrying.`)}
  finally{importing=false;pendingFiles=[];setBusy(false);importer.disabled=false;importer.textContent='Bulk import';startButton.textContent='Import PDFs';startButton.disabled=true;$('#bulkChooseFiles').disabled=false;$('#bulkImportClose').disabled=false;$('#bulkImportCancel').disabled=false;$('#bulkImportCancel').textContent='Done';zone.setAttribute('aria-busy','false');update()}
 };
 return {update};
}
