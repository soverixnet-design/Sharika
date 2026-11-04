// Consume untrusted finance/game JSON with an explicit byte budget. Reading
// request.json() and checking the result afterwards does not cap memory use.
export async function readBoundedJson(request,maxBytes=8192){
  const declared=Number(request.headers?.get?.('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)
    throw new Error('body_too_large');
  if(request.body&&typeof request.body.getReader==='function'){
    const reader=request.body.getReader(),decoder=new TextDecoder();
    let bytes=0,body='';
    try{
      while(true){
        const part=await reader.read();
        if(part.done)break;
        bytes+=part.value?.byteLength||0;
        if(bytes>maxBytes){await reader.cancel();throw new Error('body_too_large');}
        body+=decoder.decode(part.value,{stream:true});
      }
      body+=decoder.decode();
    }finally{reader.releaseLock();}
    return JSON.parse(body);
  }
  // The branch below supports plain test doubles; real Worker requests have
  // a byte stream for POST bodies.
  if(typeof request.text==='function'){
    const body=await request.text();
    if(new TextEncoder().encode(body).byteLength>maxBytes)
      throw new Error('body_too_large');
    return JSON.parse(body);
  }
  return request.json();
}
