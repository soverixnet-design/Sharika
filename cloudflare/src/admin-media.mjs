// Public, unguessable cosmetic/gift media; only verified Super Admins upload.
// R2 is required: do not put animation/video bytes in the D1 finance database.
const MAX_MEDIA_BYTES=25*1024*1024;
const TYPES=new Map([
  ['image/png',['image','png']],['image/jpeg',['image','jpg']],
  ['image/webp',['image','webp']],['video/mp4',['video','mp4']],
  ['video/webm',['video','webm']],['audio/mpeg',['audio','mp3']],
  ['audio/mp4',['audio','m4a']],['audio/ogg',['audio','ogg']]
]);
const MEDIA_PATH=/^\/api\/v1\/media\/([a-f0-9-]{36})\.(png|jpg|webp|mp4|webm|mp3|m4a|ogg)$/;

export function safeMediaUrl(value){
  if(value==='')return '';
  if(typeof value!=='string'||value.length>500)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||!url.hostname||
       /[\x00-\x20<>"']/u.test(value))return null;
    return url.href;
  }catch{return null;}
}

function validMagic(bytes,type){
  const prefix=(...n)=>n.every((value,i)=>bytes[i]===value);
  if(type==='image/png')return prefix(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
  if(type==='image/jpeg')return prefix(0xff,0xd8,0xff);
  if(type==='image/webp')return String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&
    String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(type==='video/mp4'||type==='audio/mp4')
    return String.fromCharCode(...bytes.slice(4,8))==='ftyp';
  if(type==='video/webm')return prefix(0x1a,0x45,0xdf,0xa3);
  if(type==='audio/mpeg')return prefix(0x49,0x44,0x33)||
    (bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
  if(type==='audio/ogg')return String.fromCharCode(...bytes.slice(0,4))==='OggS';
  return false;
}

async function boundedBytes(request,declared){
  if(!request.body?.getReader)return null;
  const reader=request.body.getReader(),chunks=[];
  let length=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>MAX_MEDIA_BYTES||length>declared){await reader.cancel();return null;}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  if(length!==declared)return null;
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

export async function handleAdminMediaUpload({request,env,uid,role,cors,reply,fail}){
  if(request.method!=='POST')return fail('admin_method_not_allowed',405,cors);
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(!env.MEDIA_BUCKET)return fail('media_storage_not_configured',503,cors);
  const mime=(request.headers.get('content-type')||'').toLowerCase().split(';')[0].trim();
  const description=TYPES.get(mime);
  if(!description)return fail('unsupported_media_type',415,cors);
  const category=request.headers.get('x-sharika-media-category')||'';
  if(category!==description[0])return fail('media_category_mismatch',400,cors);
  const rawSize=request.headers.get('x-sharika-media-size')||request.headers.get('content-length');
  const declared=Number(rawSize);
  if(!rawSize||!Number.isSafeInteger(declared)||declared<12)
    return fail('media_content_length_required',411,cors);
  if(declared>MAX_MEDIA_BYTES)return fail('media_too_large',413,cors);
  const transport=request.headers.get('content-length');
  if(transport&&Number(transport)!==declared)return fail('media_size_mismatch',400,cors);
  const bytes=await boundedBytes(request,declared);
  if(!bytes||!validMagic(bytes,mime))return fail('invalid_media_file',400,cors);
  const key='studio/'+crypto.randomUUID()+'.'+description[1];
  await env.MEDIA_BUCKET.put(key,bytes,{
    httpMetadata:{contentType:mime,cacheControl:'public, max-age=31536000, immutable'},
    customMetadata:{uploadedBy:uid,category}
  });
  await env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
    .bind(uid,'media_upload',JSON.stringify({key,category,bytes:declared,mime})).run();
  return reply({uploaded:true,category,bytes:declared,
    url:new URL('/api/v1/media/'+key.slice('studio/'.length),request.url).href},201,cors);
}

export async function servePublicMedia(request,env,path){
  const match=MEDIA_PATH.exec(path);
  if(!match)return null;
  const headers={
    'access-control-allow-origin':'*','x-content-type-options':'nosniff',
    'accept-ranges':'bytes','cache-control':'public, max-age=31536000, immutable'
  };
  if(!['GET','HEAD'].includes(request.method))
    return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}});
  if(!env.MEDIA_BUCKET)return new Response(null,{status:503,headers});
  const key='studio/'+match[1]+'.'+match[2];
  const meta=await env.MEDIA_BUCKET.head(key);
  if(!meta)return new Response(null,{status:404,headers});
  const mime=meta.httpMetadata?.contentType||'application/octet-stream';
  headers['content-type']=mime;
  headers['content-disposition']='inline';
  headers['x-content-type-options']='nosniff';
  headers['etag']=meta.httpEtag;
  const range=request.headers.get('range');
  let offset=0,length=meta.size,status=200;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid=()=>new Response(null,{status:416,headers:{...headers,
      'content-range':'bytes */'+meta.size}});
    if(!match||(!match[1]&&!match[2]))return invalid();
    const start=match[1]?Number(match[1]):null;
    const end=match[2]?Number(match[2]):null;
    if((start!==null&&!Number.isSafeInteger(start))||
       (end!==null&&!Number.isSafeInteger(end)))return invalid();
    if(start===null){length=Math.min(end,meta.size);offset=meta.size-length;}
    else{offset=start;length=(end===null?meta.size-1:Math.min(end,meta.size-1))-offset+1;}
    if(!length||length<0||offset>=meta.size)return invalid();
    status=206;
    headers['content-range']='bytes '+offset+'-'+(offset+length-1)+'/'+meta.size;
  }
  headers['content-length']=String(length);
  if(request.method==='HEAD')return new Response(null,{status,headers});
  const object=await env.MEDIA_BUCKET.get(key,range?{range:{offset,length}}:undefined);
  if(!object)return new Response(null,{status:404,headers});
  return new Response(object.body,{status,headers});
}
