import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleRoomAdminAssignment} from '../src/moderation.mjs';

function setup({owner=true,present=true,targetOwner=false,active=true}={}) {
  const sqls=[],calls=[];
  const db={
    prepare(sql) {
      sqls.push(sql);
      return {
        bind(...args){this.args=args;calls.push({sql,args});return this;},
        async first(){
          return {user_id:targetOwner?'owner-uid':'guest-uid',
            status:active?'active':'blocked',
            member_uid:present?'guest-uid':null};
        },
        async all(){return {results:[{
          public_no:10000003,name:'Verified Moderator',pic:null,special_id:'222'
        }]};}
      };
    },
    async batch(statements){calls.push({batch:statements.length});return [];}
  };
  const env={DB:db};
  async function send(action,target_public_id='10000003',method='POST') {
    const request=new Request('https://staging.example/api/v1/rooms/10000001/admins',{
      method,body:method==='POST'?JSON.stringify({action,target_public_id}):undefined
    });
    const res=await handleRoomAdminAssignment({
      request,env,uid:owner?'owner-uid':'other-uid',
      room:{owner_id:'owner-uid'},roomId:'10000001',
      reply:(data,status)=>Response.json(data,{status}),
      fail:(error,status)=>Response.json({error},{status}),
      cors:{},readBody:req=>req.json()
    });
    return {status:res.status,body:await res.json()};
  }
  return {send,sqls,calls};
}

test('verified owner can grant and revoke admin for a room member',async()=>{
  const s=setup();
  const grant=await s.send('grant');
  assert.equal(grant.status,200);
  assert.equal(grant.body.role,'admin');
  assert.ok(s.sqls.some(sql=>sql.includes('INSERT INTO sharika_room_admins')));
  assert.ok(s.sqls.some(sql=>sql.includes('sharika_room_admin_audit')));
  assert.ok(s.calls.some(x=>x.batch===2));
  const revoke=await s.send('revoke');
  assert.equal(revoke.status,200);
  assert.equal(revoke.body.role,'member');
  assert.ok(s.sqls.some(sql=>sql.includes('DELETE FROM sharika_room_admins')));
});

test('ordinary user cannot grant or revoke room admin',async()=>{
  const s=setup({owner:false});
  assert.equal((await s.send('grant')).status,403);
  assert.equal((await s.send('revoke')).status,403);
  assert.equal(s.sqls.length,0);
});

test('owner role and inactive or absent target are protected',async()=>{
  let s=setup({targetOwner:true});
  assert.equal((await s.send('grant')).body.error,'cannot_change_room_owner');
  s=setup({present:false});
  assert.equal((await s.send('grant')).body.error,'room_member_not_found');
  s=setup({active:false});
  assert.equal((await s.send('grant')).status,404);
});

test('rejects arbitrary mutation and bogus IDs; owner can view current Admins',async()=>{
  const s=setup();
  assert.equal((await s.send('transfer')).status,400);
  assert.equal((await s.send('grant','not-an-id')).status,400);
  const list=await s.send('ignored','10000003','GET');
  assert.equal(list.status,200);
  assert.deepEqual(list.body.admins.map(x=>x.public_id),['10000003']);
  assert.equal(list.body.admins[0].display_id,'222');
  assert.ok(s.sqls.some(sql=>sql.includes('FROM sharika_room_admins a')));
  const guest=setup({owner:false});
  assert.equal((await guest.send('ignored','10000003','GET')).status,403);
});

test('Android bridge, server member role and UI include room admin feature',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../migrations/0052_room_admins.sql',import.meta.url),'utf8');
  assert.match(src,/action==='admins'/);
  assert.match(src,/CASE WHEN m.user_id=\? THEN 'owner' WHEN ra.user_id IS NOT NULL THEN 'admin'/);
  assert.match(java,/\/api\/v1\/rooms\/\[0-9\]\{8\}\/admins\$/);
  assert.match(ui,/Make Room Admin/);
  assert.match(ui,/Remove Room Admin/);
  assert.match(ui,/__sharikaRoomRole/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_room_admins/);
});

test('room-admin icon stays off purchased frames while safety actions remain usable',()=>{
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const java=readFileSync(new URL(
    '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',
    import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(ui,/const isOwner=seat\.room_role==='owner'/);
  assert.doesNotMatch(ui,/seat\.room_role==='owner'\?'👑':'🛡'/);
  assert.match(ui,/showRoomSafetyPanel/);
  assert.match(ui,/Kick 10m/);
  assert.match(ui,/Unblock/);
  assert.match(worker,/action==='bans'/);
  assert.match(java,/\/api\/v1\/rooms\/\[0-9\]\{8\}\/bans/);
});


test('owner and admin self-state survives transient presence roster gaps',()=>{
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const ownRole=worker.indexOf('const ownMemberRole=');
  const visibleRoster=worker.indexOf('const visibleMembers=(result.results||[]).filter',ownRole);
  assert.ok(ownRole>0&&visibleRoster>ownRole,
    'verified own role must be resolved before filtering the public roster');
  assert.match(worker,/self_state:\{role:ownMemberRole,seat_no:member\.seat_no,muted:!!member\.muted\}/);
  assert.match(ui,/const selfState=data\.self_state\|\|null/);
  assert.match(ui,/selfState\?\.role==='admin'/);
  assert.match(ui,/Number\.isInteger\(selfState\.seat_no\)&&selfState\.seat_no>0&&!selfState\.muted/);
  assert.match(ui,/:\!\!self && self\.seat_no!==null && !self\.muted/);
});
