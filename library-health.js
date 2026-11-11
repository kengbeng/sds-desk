import {checkLibraryHealth,repairEmptyRecordFiles} from './folder.js';
import {ask,notice} from './dialogs.js';
export function initLibraryHealth({isBusy,setBusy,load}){
 const dialog=document.createElement('dialog');dialog.id='libraryHealth';dialog.setAttribute('aria-labelledby','libraryHealthTitle');
 dialog.innerHTML='<div class="dialoghead"><h2 id="libraryHealthTitle">Library health</h2><button id="healthClose" aria-label="Close Library health">✕</button></div><div class="settings-body"><p>Check record files, history references and whether linked PDFs can be read. Let cloud sync finish before checking. Close other SDS Desk windows before repairing.</p><p id="healthStatus" role="status" aria-live="polite"></p><ul id="healthIssues"></ul><p id="healthRecovery"></p><p>Only confirmed empty record files can be moved automatically. A recovery copy is kept. Non-empty damaged files need review or restoration from a backup. This check does not validate the PDF contents or SDS details.</p></div><div class="dialogfoot"><button id="healthDownload" disabled>Download report</button><button id="healthCheck">Check again</button><button id="healthRepair" class="primary" disabled>Move empty files to Recovery</button></div>';
 document.body.append(dialog);const $=s=>dialog.querySelector(s);let report,running=false;
 const close=()=>{if(!running)dialog.close()};$('#healthClose').onclick=close;dialog.addEventListener('cancel',e=>{if(running)e.preventDefault()});
 function buttons(){const empty=report?.issues.filter(i=>i.kind==='empty-record').length||0;$('#healthRepair').disabled=running||!empty;$('#healthRepair').textContent=empty?`Move ${empty} empty file${empty===1?'':'s'} to Recovery`:'Move empty files to Recovery';$('#healthCheck').disabled=$('#healthClose').disabled=running;$('#healthDownload').disabled=running||!report}
 function render(){
  $('#healthStatus').textContent=`${report.records} readable SDS record(s), ${report.versions} readable version(s), ${report.pdfs} linked PDF(s). ${report.issues.length?report.issues.length+' issue(s) found.':'No issues found.'}`;
  $('#healthIssues').replaceChildren();
  for(const issue of report.issues){const item=document.createElement('li'),name=document.createElement('strong'),reason=document.createElement('p'),path=document.createElement('code');name.textContent=issue.recordName||'Unknown record';reason.textContent=issue.reason;path.textContent=issue.path;item.append(name,reason,path);$('#healthIssues').append(item)}buttons();
 }
 async function scan(){
  if(running||isBusy())return;running=true;setBusy(true);report=null;buttons();$('#healthIssues').replaceChildren();$('#healthStatus').textContent='Checking record files and linked PDFs…';
  try{report=await checkLibraryHealth();render()}catch(e){$('#healthStatus').textContent='Library check failed: '+e.message}finally{running=false;setBusy(false);buttons()}
 }
 document.querySelector('#checkLibraryHealth').onclick=()=>{if(isBusy())return notice('Finish the current operation before checking the library.');$('#healthRecovery').textContent='';dialog.showModal();scan()};$('#healthCheck').onclick=scan;
 $('#healthRepair').onclick=async()=>{
  if(running||isBusy()||!report)return;
  if(!await ask('Move the confirmed empty record files to Recovery? Copies are kept under SDS-Desk/_system/recovery. Only files that are still empty and unchanged will be moved. Close other SDS Desk windows and let cloud sync finish before continuing.'))return;
  if(isBusy())return;running=true;setBusy(true);buttons();
  try{const result=await repairEmptyRecordFiles(report);$('#healthRecovery').textContent=`Moved ${result.moved.length} empty file(s).`+(result.recoveryPath?' Recovery copies: '+result.recoveryPath:'')+(result.skipped.length?'\n'+result.skipped.join('\n'):'')+(!result.indexRebuilt?' The folder summary could not be rebuilt. Check folder permissions.':'');await load();report=await checkLibraryHealth();render()}
  catch(e){$('#healthStatus').textContent='Repair stopped: '+e.message+'. Previously moved files remain in Recovery.'}finally{running=false;setBusy(false);buttons()}
 };
 $('#healthDownload').onclick=()=>{if(!report||running)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='SDS-Desk-library-health-'+report.checkedAt.slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)};
}
