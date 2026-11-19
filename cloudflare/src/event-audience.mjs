// Member profile country is manually selected in Sharika. Never use IP or GPS.
// The older account database contains both ISO-2 codes and spelled-out names.
const COUNTRY_ALIASES=Object.freeze({
 BANGLADESH:'BD',INDIA:'IN',OMAN:'OM',GERMANY:'DE',
 'UNITED STATES':'US','UNITED STATES OF AMERICA':'US',
 'UNITED KINGDOM':'GB',SAUDI_ARABIA:'SA','SAUDI ARABIA':'SA',
 'UNITED ARAB EMIRATES':'AE',PAKISTAN:'PK',NEPAL:'NP'
});
export function normalizedMemberCountry(value){
 const country=String(value||'').trim().toUpperCase();
 if(/^[A-Z]{2}$/.test(country))return country;
 return Object.hasOwn(COUNTRY_ALIASES,country)?COUNTRY_ALIASES[country]:'';
}
export function validEventAudience(value){
 return value===undefined||value==='GLOBAL'||
   (typeof value==='string'&&/^[A-Z]{2}$/.test(value));
}
export function eventAudienceAllows(countryCode,memberCountry){
 const audience=countryCode||'GLOBAL';
 return audience==='GLOBAL'||audience===normalizedMemberCountry(memberCountry);
}
export async function readMemberCountry(db,uid){
 const member=await db.prepare("SELECT country FROM sharika_users WHERE auth_uid=? AND status='active'")
   .bind(uid).first();
 return normalizedMemberCountry(member?.country);
}
