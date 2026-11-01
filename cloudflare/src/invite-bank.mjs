// Withdrawal instructions are personal banking data: only masked metadata is
// returned in lists. Finance opens full details on an authenticated endpoint.
const enc=new TextEncoder();
const dec=new TextDecoder();
const allowed=/^[\p{L}\p{N} .,'()\-/&]+$/u;
const clean=(value,min,max)=>typeof value==='string'&&value.trim().length>=min&&
  value.trim().length<=max&&allowed.test(value.trim())?value.trim():null;
export function validateBankForm(input){
  if(!input||typeof input!=='object'||input.payout_method!=='bank')return null;
  const bank_name=clean(input.bank_name,2,100);
  const account_holder=clean(input.account_holder,2,100);
  const account_number=clean(input.account_number,6,40);
  const branch=clean(input.branch,2,100);
  if(!bank_name||!account_holder||!account_number||!branch||
     !/[0-9]{4,}/.test(account_number))return null;
  return {payout_method:'bank',bank_name,account_holder,account_number,branch};
}
async function keyFromEnv(env){
  const encoded=env.INVITE_BANK_ENCRYPTION_KEY_B64;
  if(typeof encoded!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error('bank_encryption_unavailable');
  const raw=Uint8Array.from(atob(encoded),x=>x.charCodeAt(0));
  if(raw.length!==32)throw new Error('bank_encryption_unavailable');
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptBankDetails(env,input){
  const key=await keyFromEnv(env);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,
    enc.encode(JSON.stringify(input)));
  const base64=data=>btoa(String.fromCharCode(...new Uint8Array(data)));
  return {ciphertext:base64(encrypted),iv:base64(iv),
    last4:input.account_number.replace(/\D/g,'').slice(-4)};
}
export async function decryptBankDetails(env,record){
  const key=await keyFromEnv(env);
  const bytes=value=>Uint8Array.from(atob(value),x=>x.charCodeAt(0));
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(record.bank_details_iv)},
    key,bytes(record.bank_details_ciphertext))));
}
