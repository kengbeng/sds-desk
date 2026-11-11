import {APP_VERSION,RELEASE_LABEL} from './version.js';
import {ask} from './dialogs.js';
export function initInstall({isUnsafe,setRegistration}){
 const $=s=>document.querySelector(s),button=$('#install');
 let registration,promptEvent,checking=false,applying=false,downloadFailed=false,installationObserved=false,pendingReload=false,refreshing=false;
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const dialog=document.createElement('dialog');dialog.id='installedStatus';dialog.setAttribute('aria-labelledby','installedTitle');
 dialog.innerHTML='<div class="dialoghead"><h2 id="installedTitle">App info</h2><button id="installedClose" aria-label="Close app info">✕</button></div><div class="settings-body"><p id="appVersion"></p><p id="appWindowMode"></p><p id="appOffline"></p><p id="installedMessage" role="status"></p><p>Updating reloads open SDS Desk windows. Save and close record editors before updating.</p><details id="installInstructions"><summary>How to install</summary><p>In Chrome or Edge, open the browser menu and choose Install SDS Desk / Apps → Install this site as an app. On iPhone or iPad, use Safari → Share → Add to Home Screen. Installation options depend on your browser. Use the same browser profile to keep access to your library.</p></details></div><div class="dialogfoot"><button id="installedDone">Done</button><button id="installAction" hidden>Install app</button><button id="installedUpdate" class="primary">Check for updates</button></div>';
 document.body.append(dialog);$('#appVersion').textContent=`Version ${APP_VERSION} · Updated ${RELEASE_LABEL}`;
 const message=text=>{$('#installedMessage').textContent=text};
 function updateUI(){
  const waiting=!!registration?.waiting,downloading=!!registration?.installing;
  button.textContent=waiting?'Update available':promptEvent&&!standalone()?'Install app':'App info';button.disabled=applying;
  $('#appWindowMode').textContent=standalone()?'Running in the installed app window.':installationObserved?'Installation completed in this browser.':'Running in a browser tab.';
  $('#appOffline').textContent=registration?.active?'Offline app files are ready. Your PDFs must also be available locally.':'Offline app files are not ready yet.';
  $('#installAction').hidden=!promptEvent||standalone();$('#installAction').disabled=applying;
  $('#installInstructions').hidden=standalone()||installationObserved;
  $('#installedUpdate').disabled=checking||applying||downloading||!registration;
  $('#installedUpdate').textContent=applying?'Updating…':waiting?'Update and reload':downloading?'Downloading…':checking?'Checking…':'Check for updates';
 }
 function watch(worker){if(!worker)return;message(registration?.active?'Downloading an update…':'Preparing offline app files…');updateUI();worker.addEventListener('statechange',()=>{
   if(worker.state==='installed'){downloadFailed=false;message(registration.waiting?'A new version is ready. Choose Update and reload.':'Offline app files are ready.')}
   if(worker.state==='redundant'){downloadFailed=true;message('The download did not complete. Check your connection and try again.')}
   updateUI();
  })}
 async function install(){if(!promptEvent)return;const event=promptEvent;promptEvent=null;updateUI();try{await event.prompt();const choice=await event.userChoice;message(choice.outcome==='accepted'?'Installation accepted. Your browser will finish installing the app.':'Installation cancelled. You can install later.')}catch(e){message('Installation could not start. '+e.message)}updateUI()}
 async function applyUpdate(){
  if(applying||!registration?.waiting)return;
  if(isUnsafe()){message('Finish the current operation and close record editors before updating.');return}
  if(!await ask('Update and reload all open SDS Desk windows? Saved records and PDFs will be retained. Save and close any open record editors first.'))return;
  if(isUnsafe()){message('Finish the current operation before updating.');return}
  applying=true;message('Checking open SDS Desk windows…');updateUI();
  try{
   const worker=registration.waiting;if(!worker)throw Error('The update is no longer waiting. Check for updates again.');
   const result=await new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('Could not check every app window. Close other SDS Desk tabs and try again.'))},7000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data)};worker.postMessage({type:'PREPARE_UPDATE'},[channel.port2])});
   if(!result.ok)throw Error(result.reason||'Save and close editors in other SDS Desk windows, then try again.');
   message('Updating and reloading…');
  }catch(e){applying=false;message(e.message);updateUI()}
 }
 $('#installedClose').onclick=$('#installedDone').onclick=()=>dialog.close();$('#installAction').onclick=install;
 button.onclick=()=>{updateUI();if(registration?.waiting)message('A new version is ready. Choose Update and reload.');dialog.showModal();if(promptEvent&&!registration?.waiting&&!standalone())install()};
 $('#installedUpdate').onclick=async()=>{
  if(registration?.waiting)return applyUpdate();if(checking||applying||registration?.installing)return;
  checking=true;downloadFailed=false;message('Checking for updates…');updateUI();
  try{if(!registration)throw Error('Offline app support is unavailable.');if(!navigator.onLine)throw Error('You are offline. Reconnect to check for updates.');await registration.update();if(!downloadFailed)message(registration.waiting?'A new version is ready. Choose Update and reload.':registration.installing?'Downloading an update…':`Version ${APP_VERSION} is up to date.`)}catch(e){message('Update check failed. '+e.message)}finally{checking=false;updateUI()}
 };
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptEvent=e;updateUI()});window.addEventListener('appinstalled',()=>{installationObserved=true;promptEvent=null;message('SDS Desk was installed successfully.');updateUI()});
 matchMedia('(display-mode: standalone)').addEventListener('change',updateUI);
 let releaseLock;
 navigator.serviceWorker?.addEventListener('message',e=>{
  if(e.data?.type==='UPDATE_CHECK'){
   const safe=!isUnsafe();if(safe){document.documentElement.inert=true;clearTimeout(releaseLock);releaseLock=setTimeout(unlock,10000)}
   e.ports[0]?.postMessage({safe});
  }else if(e.data?.type==='UPDATE_RELEASE')unlock();
 });
 function unlock(){clearTimeout(releaseLock);document.documentElement.inert=false}
 let hadController=!!navigator.serviceWorker?.controller;
 navigator.serviceWorker?.addEventListener('controllerchange',()=>{
  unlock();if(!hadController){hadController=true;updateUI();return}
  pendingReload=true;reloadWhenSafe();
 });
 function reloadWhenSafe(){if(!pendingReload||refreshing)return;if(isUnsafe()){message('An update is ready. Finish your work and close the editor; the app will then reload.');button.textContent='Update ready';return}refreshing=true;location.reload()}
 setInterval(reloadWhenSafe,1000);
 if('serviceWorker'in navigator){navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{scope:new URL('./',import.meta.url).href}).then(r=>{registration=r;setRegistration(r);updateUI();if(r.waiting)message('A new version is ready. Choose Update and reload.');watch(r.installing);r.addEventListener('updatefound',()=>{downloadFailed=false;watch(r.installing)})}).catch(e=>{message('Offline app support is unavailable. '+e.message);updateUI()})}else message('This browser does not support offline app installation.');
 updateUI();
}
