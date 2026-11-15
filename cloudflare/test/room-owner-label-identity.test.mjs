import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');

function resolveRole(roomId,currentRoomId,roles,verifiedOwnerId,publicId){
  const start=ui.indexOf('    const verifiedMemberRole=publicId=>{');
  const end=ui.indexOf('    // The bundled offline room artwork contains demo greetings.',start);
  assert.ok(start>=0&&end>start,'must locate room-local role resolver');
  const helper=ui.slice(start,end);
  const frame={
    __sharikaRoleRoomId:currentRoomId,
    __sharikaMemberRoles:new Map(roles),
    __sharikaVerifiedOwnerPublicId:verifiedOwnerId
  };
  const room={id:roomId};
  return vm.runInNewContext(helper+';verifiedMemberRole(publicId)',{frame,room,publicId});
}

test('a guest with public ID 10000001 is never shown as owner of another room',()=>{
  const roomId='10000018';
  const roles=[['10000001','owner'],['10000018','owner']];
  assert.equal(resolveRole(roomId,roomId,roles,'10000018','10000001'),'member');
  assert.equal(resolveRole(roomId,roomId,roles,'10000018','10000018'),'owner');
});

test('old room roles are ignored after changing rooms',()=>{
  assert.equal(resolveRole('10000018','10000001',[['10000001','owner']],
    '10000001','10000001'),'member');
  assert.equal(resolveRole('10000018','10000018',[['10000001','admin']],
    '10000018','10000001'),'admin');
  assert.equal(resolveRole('10000018','10000018',[['10000001','member']],
    '10000018','10000001'),'member');
});

test('owner identity is explicitly supplied by the server, not inferred from room ID',()=>{
  assert.match(worker,/owner_user_id:room.owner_id/);
  assert.match(ui,/if\(data.owner_user_id\)room.owner_id=String\(data.owner_user_id\)/);
  assert.match(ui,/frame.__sharikaVerifiedOwnerPublicId=String/);
  assert.match(ui,/m.user_id===room.owner_id\?'owner'/);
});

test('seat preview and optimistic mic placement use verified current-room role',()=>{
  assert.match(ui,/const verifiedRole=verifiedMemberRole\(publicId\)/);
  assert.match(ui,/const verifiedRole=verifiedMemberRole\(selected.public_id\)/);
  assert.match(ui,/const selectedRole=verifiedMemberRole\(verifiedId\)/);
  assert.match(ui,/room_role:owner\?'owner':verifiedMemberRole\(profile\?\.public_id\)/);
  assert.match(ui,/frame.__sharikaMemberRoles=new Map\(\)/);
});
