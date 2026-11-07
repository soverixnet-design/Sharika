// Persistent user receipts are separate from direct messages. Writes happen only
// after the verified business transaction commits. A missing FCM integration can
// never erase a receipt or reject a successful purchase/recharge.
import {notifyUser,deliverNotification} from './notifications.mjs';
export async function recordUserEvent({db,env,ctx,recipientUid,kind='system',title,body,dedupeKey,createdBy=null}){
  try{
    const saved=await notifyUser(db||env?.DB,{recipientUid,kind,title,body,dedupeKey,createdBy});
    if(saved.created&&saved.notification&&env){
      const delivery=deliverNotification(env,saved.notification)
        .catch(error=>console.error('user_event_push_failed',String(error?.message||error)));
      if(ctx?.waitUntil)ctx.waitUntil(delivery);
      else await delivery;
    }
    return !!saved.created;
  }catch(error){
    console.error('user_event_receipt_failed',String(error?.message||error));
    return false;
  }
}
