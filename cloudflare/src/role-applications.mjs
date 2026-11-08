// Authenticated recruitment applications. Being shortlisted does NOT grant
// Admin, BD, Manager or Seller permissions. Super Admin uses the dedicated
// role/staff onboarding workflow after separately verifying an applicant.
const ROLES=new Set(['manager','bd','admin','super','coin_seller']);
const STATUSES=new Set(['shortlisted','rejected']);
const records=result=>result?.results||[];
const validString=(value,min,max)=>typeof value==='string'&&
  value===value.trim()&&value.length>=min&&value.length<=max&&
  !/[\u0000-\u001f\u007f]/.test(value);

async function jsonBody(request,max=2500){
  const length=Number(request.headers.get('content-length')||0);
  if(length>max)throw Error('body_too_large');
  const raw=await request.text();
  if(raw.length>max)throw Error('body_too_large');
  try{return JSON.parse(raw||'{}');}catch{throw Error('invalid_application_json');}
}

export function validateRoleApplication(value){
  if(!value||Array.isArray(value)||typeof value!=='object'||
     Object.keys(value).some(key=>!['requested_role','country','contact','experience'].includes(key)))
    return null;
  if(!ROLES.has(value.requested_role)||
     !validString(value.country,2,60)||!validString(value.contact,5,120)||
     !validString(value.experience,20,500))return null;
  return {requested_role:value.requested_role,country:value.country,
    contact:value.contact,experience:value.experience};
}

export async function handleRoleApplicationApp({request,env,uid,path,cors,reply,fail}){
  if(path!=='/api/v1/role-applications')return null;
  const user=await env.DB.prepare('SELECT auth_uid FROM sharika_users WHERE auth_uid=? '+
    "AND status='active'").bind(uid).first();
  if(!user)return fail('profile_unavailable',403,cors);
  if(request.method==='GET'){
    const result=await env.DB.prepare('SELECT id,requested_role,country,status,created_at,'+
      'reviewed_at FROM sharika_role_applications WHERE applicant_uid=? '+
      'ORDER BY id DESC LIMIT 20').bind(uid).all();
    return reply({applications:records(result),grants_access:false},200,cors);
  }
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  let body;
  try{body=await jsonBody(request);}catch(error){return fail(error.message,400,cors);}
  const data=validateRoleApplication(body);
  if(!data)return fail('invalid_application',400,cors);
  const existing=await env.DB.prepare('SELECT COUNT(*) AS count FROM sharika_role_applications '+
    "WHERE applicant_uid=? AND created_at>=datetime('now','-30 days')")
    .bind(uid).first();
  if(Number(existing?.count)>=5)return fail('application_monthly_limit',429,cors);
  try{
    const result=await env.DB.prepare('INSERT INTO sharika_role_applications '+
      '(applicant_uid,requested_role,country,contact,experience) VALUES(?,?,?,?,?)')
      .bind(uid,data.requested_role,data.country,data.contact,data.experience).run();
    return reply({submitted:true,id:Number(result.meta?.last_row_id),status:'pending',
      grants_access:false},201,cors);
  }catch(error){
    if(/UNIQUE constraint/i.test(String(error)))return fail('application_pending',409,cors);
    throw error;
  }
}

export async function handleRoleApplicationAdmin({request,db,uid,role,operation,cors,reply,fail}){
  const match=/^role-applications\/([1-9][0-9]*)$/.exec(operation);
  if(operation!=='role-applications'&&!match)return null;
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='role-applications'&&request.method==='GET'){
    const result=await db.prepare('SELECT a.id,a.requested_role,a.country,a.contact,'+
      'a.experience,a.status,a.review_note,a.created_at,a.reviewed_at,'+
      'u.public_no,u.name FROM sharika_role_applications a '+
      'JOIN sharika_users u ON u.auth_uid=a.applicant_uid '+
      'ORDER BY CASE a.status WHEN \'pending\' THEN 0 ELSE 1 END,a.id DESC LIMIT 100').all();
    return reply({applications:records(result).map(row=>({
      ...row,public_id:String(row.public_no).padStart(8,'0'),public_no:undefined
    })),grants_access:false},200,cors);
  }
  if(!match||request.method!=='PATCH')return fail('method_not_allowed',405,cors);
  let body;
  try{body=await jsonBody(request,800);}catch(error){return fail(error.message,400,cors);}
  if(!body||Array.isArray(body)||typeof body!=='object'||
     Object.keys(body).some(key=>!['status','note'].includes(key))||
     !STATUSES.has(body.status)||!validString(body.note,0,300))
    return fail('invalid_application_review',400,cors);
  const id=Number(match[1]);
  if(!Number.isSafeInteger(id))return fail('invalid_application_id',400,cors);
  const result=await db.batch([
    db.prepare('UPDATE sharika_role_applications SET status=?,reviewer_uid=?,'+
      "review_note=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'")
      .bind(body.status,uid,body.note,id),
    db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
      'SELECT ?,?,? WHERE changes()=1')
      .bind(uid,'role_application_review',JSON.stringify({id,status:body.status}))
  ]);
  if(!result[0]?.meta?.changes)return fail('application_not_pending',409,cors);
  return reply({reviewed:true,id,status:body.status,grants_access:false},200,cors);
}
