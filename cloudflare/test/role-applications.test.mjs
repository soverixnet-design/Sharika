import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validateRoleApplication,handleRoleApplicationApp,handleRoleApplicationAdmin}
  from '../src/role-applications.mjs';

function fixture(){
  const raw=new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  raw.exec(readFileSync(new URL(
    '../migrations/0077_staff_role_applications.sql',import.meta.url),'utf8'));
  raw.prepare('INSERT INTO sharika_users (public_no,auth_uid,name,birthdate,minor) '+
    'VALUES (10000001,?,?,?,0)').run('applicant','Applicant','2000-01-01');
  raw.prepare('INSERT INTO sharika_users (public_no,auth_uid,name,birthdate,minor) '+
    'VALUES (10000002,?,?,?,0)').run('reviewer','Reviewer','2000-01-01');
  const db={
    prepare(sql){
      const make=args=>({sql,args,
        async first(){return raw.prepare(sql).get(...args)||null;},
        async all(){return {results:raw.prepare(sql).all(...args)};},
        async run(){const result=raw.prepare(sql).run(...args);return {
          ...result,meta:{last_row_id:Number(result.lastInsertRowid),changes:result.changes}
        };}
      });
      return {...make([]),bind(...args){return make(args);}};
    },
    async batch(statements){
      raw.exec('BEGIN');
      try{
        const result=statements.map(s=>{
          const item=raw.prepare(s.sql).run(...s.args);
          return {meta:{changes:item.changes}};
        });
        raw.exec('COMMIT');return result;
      }catch(error){raw.exec('ROLLBACK');throw error;}
    }
  };
  const response={reply:(data,status)=>({status,data}),
    fail:(error,status)=>({status,error}),cors:{}};
  const invokeApp=(method='GET',body)=>handleRoleApplicationApp({
    ...response,uid:'applicant',env:{DB:db},path:'/api/v1/role-applications',
    request:new Request('https://test.invalid/api/v1/role-applications',{
      method,body:body===undefined?undefined:JSON.stringify(body)
    })
  });
  const invokeAdmin=(role='super',method='GET',id='',body)=>handleRoleApplicationAdmin({
    ...response,db,uid:'reviewer',role,
    operation:'role-applications'+(id?'/'+id:''),
    request:new Request('https://test.invalid/api/v1/admin/role-applications'+
      (id?'/'+id:''),{method,body:body===undefined?undefined:JSON.stringify(body)})
  });
  return {raw,invokeApp,invokeAdmin};
}

const application=()=>({requested_role:'manager',country:'Bangladesh',
  contact:'telegram:applicant',
  experience:'I have helped moderate several live voice chat communities.'});

test('role applications validate data and never grant privileges',async()=>{
  const {raw,invokeApp}=fixture();
  try{
    assert.equal(validateRoleApplication({...application(),requested_role:'root'}),null);
    assert.equal(validateRoleApplication({...application(),contact:'bad\ncontact'}),null);
    assert.equal(validateRoleApplication({...application(),admin:true}),null);
    assert.equal((await invokeApp('POST',{...application(),requested_role:'root'})).status,400);
    const submitted=await invokeApp('POST',application());
    assert.equal(submitted.status,201);
    assert.equal(submitted.data.grants_access,false);
    assert.equal((await invokeApp('POST',application())).status,409);
    const mine=await invokeApp();
    assert.equal(mine.data.applications.length,1);
    assert.equal(mine.data.applications[0].status,'pending');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sharika_admin_roles').get().n,0);
  }finally{raw.close();}
});

test('only Super Admin reviews pending submissions; reviews are audited once',async()=>{
  const {raw,invokeApp,invokeAdmin}=fixture();
  try{
    const {data:{id}}=await invokeApp('POST',application());
    assert.equal((await invokeAdmin('support')).status,403);
    assert.equal((await invokeAdmin('support','PATCH',id,{status:'shortlisted',note:''})).status,403);
    assert.equal((await invokeAdmin('super','PATCH',id,{status:'approved',note:''})).status,400);
    const reviewed=await invokeAdmin('super','PATCH',id,{status:'shortlisted',note:'Reviewed'});
    assert.equal(reviewed.status,200);
    assert.equal(reviewed.data.grants_access,false);
    assert.equal((await invokeAdmin('super','PATCH',id,{status:'rejected',note:''})).status,409);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sharika_admin_audit').get().n,1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sharika_admin_roles').get().n,0);
    assert.equal((await invokeAdmin()).data.applications[0].status,'shortlisted');
  }finally{raw.close();}
});

test('role application form and banner actions are linked to verified API',()=>{
  const root=new URL('../../',import.meta.url);
  const html=readFileSync(new URL('app/index.html',root),'utf8');
  const ui=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
  const admin=readFileSync(new URL('admin/connection.js',root),'utf8');
  const worker=readFileSync(new URL('cloudflare/src/index.mjs',root),'utf8');
  assert.match(html,/sharikaOpenRoleApplication/);
  assert.match(ui,/window\.sharikaOpenRoleApplication/);
  assert.match(ui,/role-applications/);
  assert.match(admin,/sh-ra-preset/);
  assert.match(admin,/20K → 1K/);
  assert.match(worker,/handleRoleApplicationApp/);
});

test('isolated staging workflow installs the role application table before API deploy',()=>{
  const workflow=readFileSync(new URL(
    '../../.github/workflows/sharika-worker-staging-publish.yml',import.meta.url),'utf8');
  const migration='--file migrations/0077_staff_role_applications.sql';
  assert.ok(workflow.includes(migration));
  assert.ok(workflow.indexOf(migration)<workflow.indexOf('Deploy only the existing staging Worker'));
  assert.match(workflow,/SELECT COUNT\(\*\) AS role_applications FROM sharika_role_applications/);
});
