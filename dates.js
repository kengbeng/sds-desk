// Review dates are suggestions for document management, not supplier expiry dates.
export function suggestedReviewDate(revision){
 if(typeof revision!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(revision))return '';
 const year=Number(revision.slice(0,4));if(year<1||year+5>9999)return '';
 const date=new Date(revision+'T12:00:00Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==revision)return '';
 const day=date.getUTCDate();date.setUTCFullYear(year+5);if(date.getUTCDate()!==day)date.setUTCDate(0);
 return date.toISOString().slice(0,10);
}
