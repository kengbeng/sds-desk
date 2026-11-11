const names=['storage','notifications','maintenance'];
export function showSettingsTab(name,{focus=false}={}){
 if(!names.includes(name))name='storage';
 for(const tab of names){const active=tab===name,button=document.querySelector('#settingsTab-'+tab);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;document.querySelector('#settingsPanel-'+tab).hidden=!active}
 document.querySelector('#settings .settings-body').scrollTop=0;
 if(focus)document.querySelector('#settingsTab-'+name).focus();
}
export function initSettingsTabs(){
 const list=document.querySelector('#settingsTabs');
 list.addEventListener('click',event=>{const button=event.target.closest('[role=tab]');if(button)showSettingsTab(button.dataset.settingsTab)});
 list.addEventListener('keydown',event=>{const button=event.target.closest('[role=tab]');if(!button)return;let index=names.indexOf(button.dataset.settingsTab);if(event.key==='ArrowRight')index=(index+1)%names.length;else if(event.key==='ArrowLeft')index=(index+names.length-1)%names.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=names.length-1;else return;event.preventDefault();showSettingsTab(names[index],{focus:true})});
 showSettingsTab('storage');
}
