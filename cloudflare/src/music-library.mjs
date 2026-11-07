// Verified, rights-cleared music links curated by a Super Admin. Audio bytes
// are never fetched or proxied by the Worker, and no user file is uploaded.
export const MUSIC_LIBRARY_OBJECT='sharika:music-library:staging';

export function musicTitle(value){
  if(typeof value!=='string')return null;
  const text=value.trim();
  return text.length>=1&&text.length<=100&&!/[\u0000-\u001f<>]/.test(text)
    ?text:null;
}

export function musicAudioUrl(value){
  if(typeof value!=='string'||value.length>1000||/[\u0000-\u0020<>"']/.test(value))
    return null;
  try{
    const link=new URL(value);
    if(link.protocol!=='https:'||!link.hostname||link.username||link.password||
       link.port&&link.port!=='443'||link.hash)return null;
    if(!/\.(?:mp3|m4a|aac|ogg|wav)(?:$|\?)/i.test(link.pathname+link.search))
      return null;
    return link.href;
  }catch{return null;}
}

export async function handleMusicAdmin({request,env,actor,reply,fail,cors}){
  if(!env.VOICE_ROOMS)return fail('music_library_unavailable',503,cors);
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  const library=env.VOICE_ROOMS.getByName(MUSIC_LIBRARY_OBJECT);
  if(request.method==='GET')return reply(await library.musicLibraryList(true),200,cors);
  if(!['POST','PATCH'].includes(request.method))return fail('method_not_allowed',405,cors);
  const raw=await request.text();
  if(raw.length>2600)return fail('invalid_music_track',400,cors);
  let data;
  try{data=JSON.parse(raw||'{}');}catch{return fail('invalid_music_track',400,cors);}
  const title=musicTitle(data?.title),url=musicAudioUrl(data?.url);
  if(!title||!url)return fail('invalid_music_track',400,cors);
  if(request.method==='POST')return reply(await library.musicLibraryCreate(title,url),201,cors);
  if(!Number.isSafeInteger(data.id)||data.id<1||typeof data.active!=='boolean')
    return fail('invalid_music_track',400,cors);
  const result=await library.musicLibraryUpdate(data.id,title,url,data.active);
  if(result.error)return fail(result.error,404,cors);
  return reply(result,200,cors);
}
