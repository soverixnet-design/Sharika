// One safe, read-only *public* profile directory across staging and Play.
// Never federate private data, wallets, rooms, gifts, Firebase tokens, or roles.
const REAL_ID = /^[0-9]{8}$/;
const safeStr = (s,n) => typeof s==='string'?s.slice(0,n):'';
const publicId = n => String(n).padStart(8,'0');

export async function syncGlobalPublicProfile(identityDb, user, sourceEnvironment) {
  if(!identityDb?.prepare)throw new Error('global_directory_unavailable');
  if(!['staging','play_virtual'].includes(sourceEnvironment))
    throw new Error('invalid_directory_source');
  if(!user||!Number.isInteger(Number(user.public_no))||
    !REAL_ID.test(String(user.public_no))||!user.auth_uid||
    !['active','blocked','deleted'].includes(user.status))
    throw new Error('invalid_directory_profile');
  // Global registry is authoritative: the local DB never gets to claim another
  // person's number, and duplicate Firebase identities remain one directory row.
  const identity=await identityDb.prepare(
    'SELECT auth_uid FROM sharika_public_id_registry WHERE public_no=?'
  ).bind(Number(user.public_no)).first();
  if(identity?.auth_uid!==user.auth_uid)throw new Error('directory_identity_mismatch');
  const updated=safeStr(user.updated_at,32);
  if(!updated)throw new Error('directory_timestamp_missing');
  return identityDb.prepare(`
    INSERT INTO sharika_global_public_profiles (
      public_no,auth_uid,source_environment,name,country,pic,cover,
      wealth_level,charm_level,frame_style,entry_style,medal_style,name_tag_style,
      status,profile_updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(public_no) DO UPDATE SET
      source_environment=excluded.source_environment,
      name=excluded.name,country=excluded.country,pic=excluded.pic,
      cover=excluded.cover,wealth_level=excluded.wealth_level,
      charm_level=excluded.charm_level,frame_style=excluded.frame_style,
      entry_style=excluded.entry_style,medal_style=excluded.medal_style,
      name_tag_style=excluded.name_tag_style,status=excluded.status,
      profile_updated_at=excluded.profile_updated_at,synced_at=datetime('now')
    WHERE sharika_global_public_profiles.auth_uid=excluded.auth_uid AND (
      excluded.profile_updated_at>sharika_global_public_profiles.profile_updated_at OR
      (excluded.profile_updated_at=sharika_global_public_profiles.profile_updated_at
        AND (sharika_global_public_profiles.source_environment=excluded.source_environment
          OR excluded.source_environment=(SELECT origin FROM sharika_public_id_registry
            WHERE auth_uid=excluded.auth_uid)))
    )
  `).bind(
    Number(user.public_no),user.auth_uid,sourceEnvironment,
    safeStr(user.name,80),safeStr(user.country,16),safeStr(user.pic,2048)||null,
    safeStr(user.cover,2048)||null,Number(user.wealth_level)||1,
    Number(user.charm_level)||1,safeStr(user.frame_style,100),
    safeStr(user.entry_style,100),safeStr(user.medal_style,100),
    safeStr(user.name_tag_style,100),user.status,updated
  ).run();
}

export async function findGlobalPublicProfile(identityDb, requestedId) {
  if(!identityDb?.prepare||typeof requestedId!=='string'||!REAL_ID.test(requestedId))
    return null;
  const user=await identityDb.prepare(
    "SELECT p.* FROM sharika_global_public_profiles p "+
    "JOIN sharika_public_id_registry r ON r.public_no=p.public_no "+
    "AND r.auth_uid=p.auth_uid WHERE p.public_no=? AND p.status='active'"
  ).bind(Number(requestedId)).first();
  if(!user)return null;
  return {
    id:publicId(user.public_no),name:user.name,pic:user.pic,
    cover:user.cover,country:user.country,bd_active:false,seller_active:false,
    family:null,special_id:null,display_id:publicId(user.public_no),
    special_frame:null,wealth_level:user.wealth_level,charm_level:user.charm_level,
    frame_style:user.frame_style||'',entry_style:user.entry_style||'',
    medal_style:user.medal_style||'',name_tag_style:user.name_tag_style||'',
    svip_level:0,global_directory:true
  };
}
