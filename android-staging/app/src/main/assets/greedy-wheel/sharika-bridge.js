/* A private transport for the original Greedy Wheel UI in Sharika's iframe.
 * No WebSocket/network call is made from this frame. The parent authenticates
 * every operation via the Android Firebase bridge; D1 alone changes coins.
 */
(function(){
  'use strict';
  const NativeWebSocket=window.WebSocket;
  const SERVER='wss://sharika-greedy.invalid';
  const pending=new Map();
  let nextId=0,activeSocket=null;

  function request(action,body){
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending.delete(id);reject(Error('server_timeout'));},15000);
      pending.set(id,{resolve,reject,timeout});
      window.parent.postMessage({type:'sharika:greedy-request',id,action,body},'*');
    });
  }
  function randomId(){
    const bytes=new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'greedy:'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }
  function emit(socket,data){
    if(socket.readyState!==1)return;
    socket.onmessage?.({data:JSON.stringify(data)});
  }
  function handleState(socket,data){
    const st=data.state;
    if(!st||!Number.isSafeInteger(st.round))return;
    if(!socket.initialized){
      socket.initialized=true;
      socket.round=st.round;socket.phase=st.phase;
      socket.balance=data.balance;
      emit(socket,{t:'hello',serverTime:data.serverTime,user:data.user,balance:data.balance,
        config:data.config,history:data.history,state:st,myBets:data.myBets});
      // A player can open the sheet halfway through a round. Show the real
      // server result immediately instead of waiting for the next round.
      if(st.phase==='spinning')emit(socket,{t:'spin',serverTime:data.serverTime,
        round:st.round,endsAt:st.endsAt,resultId:st.resultId,totals:st.totals});
      if(st.phase==='result'&&data.result)
        emit(socket,{t:'result',serverTime:data.serverTime,...data.result});
      return;
    }
    if(socket.round!==st.round){socket.round=st.round;socket.phase=null;}
    if(st.phase==='betting'){
      emit(socket,{t:'state',serverTime:data.serverTime,...st,myBets:data.myBets});
    }else if(st.phase==='spinning'&&socket.phase!=='spinning'){
      emit(socket,{t:'spin',serverTime:data.serverTime,round:st.round,
        endsAt:st.endsAt,resultId:st.resultId,totals:st.totals});
    }else if(st.phase==='result'&&socket.phase!=='result'&&data.result){
      emit(socket,{t:'result',serverTime:data.serverTime,...data.result});
    }else{
      emit(socket,{t:'totals',round:st.round,totals:st.totals,online:st.online});
    }
    socket.phase=st.phase;
    if(Number.isSafeInteger(data.balance)&&data.balance!==socket.balance){
      socket.balance=data.balance;
      emit(socket,{t:'balance',balance:data.balance});
    }
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.data?.type!=='sharika:greedy-response')return;
    const job=pending.get(event.data.id);
    if(!job)return;
    clearTimeout(job.timeout);pending.delete(event.data.id);
    event.data.ok?job.resolve(event.data.value):job.reject(Error(event.data.error||'server_error'));
  });

  class BridgeSocket {
    constructor(url){
      if(!String(url).startsWith(SERVER+'/ws'))return new NativeWebSocket(url);
      this.readyState=0;this.initialized=false;this.round=null;this.phase=null;
      this.balance=null;activeSocket=this;
      queueMicrotask(()=>{
        if(this.readyState!==0)return;
        this.readyState=1;this.onopen?.({});
        this.poll();
        this.timer=setInterval(()=>this.poll(),1600);
      });
    }
    async poll(){
      if(this.readyState!==1||this.inFlight)return;
      this.inFlight=true;
      try{handleState(this,await request('state'));}
      catch(error){emit(this,{t:'error',message:error.message});}
      finally{this.inFlight=false;}
    }
    send(raw){
      if(this.readyState!==1)return;
      let message;try{message=JSON.parse(raw);}catch{return;}
      if(message.t==='bet'){
        const body={round:message.round,itemId:message.itemId,amount:message.amount,
          request_id:randomId()};
        // A timed-out response may already have committed a debit. Retry the
        // exact same request ID, never a fresh bet, to get its one receipt.
        const submit=()=>request('bet',body);
        submit().catch(error=>error.message==='server_timeout'?submit():Promise.reject(error))
        .then(result=>{
          emit(this,{t:'bet_ok',reqId:message.reqId,...result});
          void this.poll();
        }).catch(error=>{
          emit(this,{t:'bet_err',reqId:message.reqId,code:error.message});
          void this.poll();
        });
      }else if(message.t==='records'){
        request('records').then(result=>emit(this,{t:'records',...result}))
          .catch(error=>emit(this,{t:'error',message:error.message}));
      }else if(message.t==='balance'){
        void this.poll();
      }
    }
    close(){
      clearInterval(this.timer);this.readyState=3;
      if(activeSocket===this)activeSocket=null;
    }
  }
  BridgeSocket.CONNECTING=0;BridgeSocket.OPEN=1;
  BridgeSocket.CLOSING=2;BridgeSocket.CLOSED=3;
  window.WebSocket=BridgeSocket;
  window.GREEDY_SERVER=SERVER;
  // Never start the supplied fake-player/local-wallet demonstration in Sharika.
  window.addEventListener('pagehide',()=>activeSocket?.close());
})();
