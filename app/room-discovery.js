/* Sharika room discovery — deterministic country ranking and per-account history. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SharikaDiscovery=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const aliases={
    BANGLADESH:'BD',বাংলাদেশ:'BD',INDIA:'IN',ভারত:'IN',PAKISTAN:'PK',NEPAL:'NP',
    SRILANKA:'LK',SRI_LANKA:'LK',MYANMAR:'MM',MALAYSIA:'MY',SINGAPORE:'SG',
    INDONESIA:'ID',THAILAND:'TH',PHILIPPINES:'PH',VIETNAM:'VN',JAPAN:'JP',
    CHINA:'CN',SOUTHKOREA:'KR',SOUTH_KOREA:'KR',KOREA:'KR',
    SAUDIARABIA:'SA',SAUDI_ARABIA:'SA',UNITEDARABEMIRATES:'AE',
    UNITED_ARAB_EMIRATES:'AE',UAE:'AE',DUBAI:'AE',QATAR:'QA',OMAN:'OM',
    KUWAIT:'KW',BAHRAIN:'BH',TURKEY:'TR',TÜRKIYE:'TR',EGYPT:'EG',
    NIGERIA:'NG',UNITEDKINGDOM:'GB',UNITED_KINGDOM:'GB',UK:'GB',ENGLAND:'GB',
    UNITEDSTATES:'US',UNITED_STATES:'US',USA:'US',AMERICA:'US',
    CANADA:'CA',AUSTRALIA:'AU',GERMANY:'DE',FRANCE:'FR',ITALY:'IT',SPAIN:'ES'
  };
  function countryCode(value){
    const raw=String(value||'').trim();
    if(!raw)return '';
    const match=/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.exec(raw);
    if(match)return String.fromCodePoint(...Array.from(raw).map(c=>c.codePointAt(0)-0x1f1e6+65));
    const normalized=raw.toUpperCase().replace(/[.\s-]+/g,'_');
    if(Object.prototype.hasOwnProperty.call(aliases,normalized))return aliases[normalized];
    const compact=normalized.replace(/_/g,'');
    if(Object.prototype.hasOwnProperty.call(aliases,compact))return aliases[compact];
    return /^[A-Z]{2}$/.test(normalized)?normalized:'';
  }
  function flagForCountry(value){
    const code=countryCode(value);
    return code?String.fromCodePoint(...Array.from(code).map(c=>127397+c.charCodeAt(0))):'';
  }
  function sortRooms(rooms,viewerCountry,mode,historyIds){
    const country=countryCode(viewerCountry);
    const order=Array.isArray(historyIds)?historyIds:[];
    const historyIndex=new Map(order.map((id,index)=>[String(id),index]));
    const result=(rooms||[]).filter(r=>mode!=='history'||historyIndex.has(String(r.id)));
    return result.map((room,index)=>({room,index})).sort((left,right)=>{
      const a=left.room,b=right.room;
      const aLocal=country&&countryCode(a.owner_country||a.country)===country?1:0;
      const bLocal=country&&countryCode(b.owner_country||b.country)===country?1:0;
      if(aLocal!==bLocal)return bLocal-aLocal;
      if(mode==='history'){
        const recent=historyIndex.get(String(a.id))-historyIndex.get(String(b.id));
        if(recent)return recent;
      }else if(mode==='new'){
        const newer=String(b.created_at||'').localeCompare(String(a.created_at||''));
        if(newer)return newer;
      }else{
        const popular=(Number(b.n)||0)-(Number(a.n)||0);
        if(popular)return popular;
      }
      return left.index-right.index;
    }).map(x=>x.room);
  }
  function historyKey(userId){return 'sharika_room_history_v1:'+String(userId||'');}
  function readHistory(storage,userId){
    if(!storage||!userId)return [];
    try{
      const entries=JSON.parse(storage.getItem(historyKey(userId))||'[]');
      return Array.isArray(entries)?entries.filter(id=>/^\d{8}$/.test(String(id))).map(String).slice(0,40):[];
    }catch(_){return [];}
  }
  function recordVisit(storage,userId,roomId){
    if(!storage||!userId||!/^\d{8}$/.test(String(roomId)))return [];
    const entries=[String(roomId),...readHistory(storage,userId).filter(id=>id!==String(roomId))].slice(0,40);
    try{storage.setItem(historyKey(userId),JSON.stringify(entries));}catch(_){}
    return entries;
  }
  return {countryCode,flagForCountry,sortRooms,readHistory,recordVisit};
});
