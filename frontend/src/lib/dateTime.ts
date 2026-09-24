export function validDateTime(value:string):boolean {
  if(!value)return true;
  if (/^\d{4}$/.test(value)) return Number(value)>=1;
  const monthOnly=/^(\d{4})-(\d{2})$/.exec(value);
  if(monthOnly)return Number(monthOnly[1])>=1 && Number(monthOnly[2])>=1 && Number(monthOnly[2])<=12;
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if(!match)return false;
  const [y,m,d,h,min]=match.slice(1).map(Number);
  const leap=y%4===0 && (y%100!==0 || y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return y>=1 && m>=1 && m<=12 && d>=1 && d<=days[m-1] && (match[4]===undefined || (h<=23 && min<=59));
}
