export const exportColumns=[['name','Product name',30],['supplier','Supplier / manufacturer',30],['code','Catalogue / product number',24],['concentration','Concentration / formulation',25],['cas','CAS number(s)',20],['lab','Location',28],['revision','SDS revision date',19],['review','Review due date',19],['expiry','Explicit expiry date',19],['status','Status',22],['notes','Notes',55],['updated','Last updated',27]];
export const printDefaults=['name','supplier','concentration','cas','lab','revision','review','expiry','status'];
export function selectColumns(keys=exportColumns.map(c=>c[0])){return exportColumns.filter(([key])=>keys.includes(key))}
export function columnPicker(parent,{preference,defaults=exportColumns.map(c=>c[0]),onChange=()=>{}}){
 let selected=defaults;
 try{const saved=JSON.parse(localStorage.getItem(preference));if(Array.isArray(saved)&&saved.length&&selectColumns(saved).length)selected=saved}catch{}
 const element=document.createElement('details');element.className='column-options';element.innerHTML='<summary></summary><div class="column-grid">'+exportColumns.map(([key,label])=>`<label><input type="checkbox" data-column="${key}" ${selected.includes(key)?'checked':''}>${label}</label>`).join('')+'</div><div class="column-actions"><button type="button" data-all>Select all</button><button type="button" data-reset>Reset</button></div>';
 parent.append(element);
 const keys=()=>[...element.querySelectorAll('[data-column]:checked')].map(i=>i.dataset.column);
 function update(){element.querySelector('summary').textContent=`Columns (${keys().length} selected)`;try{localStorage.setItem(preference,JSON.stringify(keys()))}catch{}onChange(keys())}
 element.addEventListener('change',update);
 element.querySelector('[data-all]').onclick=()=>{element.querySelectorAll('[data-column]').forEach(i=>i.checked=true);update()};
 element.querySelector('[data-reset]').onclick=()=>{element.querySelectorAll('[data-column]').forEach(i=>i.checked=defaults.includes(i.dataset.column));update()};
 element.querySelector('summary').textContent=`Columns (${keys().length} selected)`;
 return {keys};
}
