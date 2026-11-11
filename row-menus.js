// Keep the actions beside their row for event delegation, but render above scroll containers.
export function initRowMenus(){
 const close=menu=>{const panel=menu.querySelector('.menu-panel');if(panel?.matches(':popover-open'))panel.hidePopover();menu.open=false};
 document.addEventListener('toggle',event=>{
  const menu=event.target;if(!menu.matches?.('details.row-menu'))return;
  const panel=menu.querySelector('.menu-panel');
  if(!menu.open){if(panel.matches(':popover-open'))panel.hidePopover();return}
  document.querySelectorAll('details.row-menu[open]').forEach(other=>{if(other!==menu)close(other)});
  const trigger=menu.querySelector('summary');
  panel.classList.add('row-actions-popup');
  if(panel.showPopover){panel.setAttribute('popover','manual');if(!panel.matches(':popover-open'))panel.showPopover()}
  const anchor=trigger.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight,gap=6;
  panel.style.left=Math.max(8,Math.min(anchor.right-width,innerWidth-width-8))+'px';
  const below=innerHeight-anchor.bottom-gap;
  panel.style.top=Math.max(8,below>=height?anchor.bottom+gap:anchor.top-height-gap)+'px';
 },true);
 const closeAll=()=>document.querySelectorAll('details.row-menu[open]').forEach(close);
 window.addEventListener('resize',closeAll);document.addEventListener('scroll',event=>{if(!event.target.closest?.('.row-actions-popup'))closeAll()},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=document.querySelector('details.row-menu[open]');if(menu){close(menu);menu.querySelector('summary').focus()}}});
}
