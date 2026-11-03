import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkProfileLayout,defaultProfileLayouts,readPublishedProfileLayouts,
 handleProfileLayoutAdmin} from '../src/profile-layout.mjs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const reply=(value,status)=>Response.json(value,{status});
const fail=(value,status)=>Response.json({error:value},{status});
const base={reply,fail,uid:'verified-super',role:'super',cors:{}};
test('global profile design validates bounded slots and safe background choices',()=>{
 const templates=defaultProfileLayouts();
 assert.deepEqual(checkProfileLayout('main',templates.main),templates.main);
 assert.deepEqual(checkProfileLayout('public',templates.public),templates.public);
 assert.equal(checkProfileLayout('main',{...templates.main,frame_scale:100000}),null);
 assert.equal(checkProfileLayout('main',{...templates.main,tag_position:'<script>'}),null);
 assert.equal(checkProfileLayout('main',{...templates.main,sections:['hero','hero',...templates.main.sections.slice(2)]}),null);
 assert.equal(checkProfileLayout('public',{...templates.public,background:'url(javascript:bad)'}),null);
 assert.equal(checkProfileLayout('unknown',templates.main),null);
});
test('published settings remain separate from unsaved drafts and from user inventory',async()=>{
 const main=defaultProfileLayouts().main;
 const changed={...main,background:'gold'};
 const db={prepare(sql){
   assert.match(sql,/SELECT screen,published_json,revision/);
   return {async all(){return {results:[{
     screen:'main',published_json:JSON.stringify(main),
     draft_json:JSON.stringify(changed),revision:5
   }]};}};
 }};
 const result=await readPublishedProfileLayouts(db);
 assert.equal(result.layouts.main.background,'original');
 assert.equal(result.revisions.main,5);
 assert.equal(result.layouts.public.background,'original');
 assert.equal(source('../src/profile-layout.mjs').includes('sharika_cosmetic_inventory'),false);
});
test('non-Super Admin cannot read, change or publish member profile layouts',async()=>{
 for(const role of ['finance','support','staff']){
   for(const method of ['GET','PATCH','POST']){
     const request=new Request('https://test/api/v1/admin/profile-layout',{method});
     const response=await handleProfileLayoutAdmin({...base,role,db:null,request});
     assert.equal(response.status,403);
   }
 }
});
test('draft and publish are separate audited operations with revision checks',async()=>{
 const captured=[];
 const db={prepare(sql){
   return {sql,args:[],bind(...args){this.args=args;return this;},
     async all(){return {results:[]};},
     async run(){captured.push({sql:this.sql,args:this.args});
       return {meta:{changes:1}};}
   };
 }};
 const layout={...defaultProfileLayouts().main,background:'gold'};
 const draft=await handleProfileLayoutAdmin({...base,db,
   request:new Request('https://test/api/v1/admin/profile-layout',{
     method:'PATCH',body:JSON.stringify({screen:'main',expected_revision:0,layout})
   })
 });
 assert.equal(draft.status,200);
 assert.ok(captured.some(x=>/UPDATE sharika_profile_layouts SET draft_json/.test(x.sql)));
 assert.ok(captured.some(x=>x.args.includes('profile_layout_draft')));
 assert.equal(captured.some(x=>x.sql.includes('sharika_cosmetic_inventory')),false);
 captured.length=0;
 const publish=await handleProfileLayoutAdmin({...base,db,
   request:new Request('https://test/api/v1/admin/profile-layout',{
     method:'POST',body:JSON.stringify({screen:'main',expected_revision:1,action:'publish'})
   })
 });
 assert.equal(publish.status,200);
 assert.ok(captured.some(x=>/published_json=draft_json/.test(x.sql)));
 assert.ok(captured.some(x=>x.args.includes('profile_layout_publish')));
});
test('API wiring, mobile editor and published renderers preserve equipped cosmetic images',()=>{
 const admin=source('../src/admin.mjs');
 const api=source('../src/index.mjs');
 const app=source('../../android-staging/staging-connection.js');
 const ui=source('../../admin/connection.js');
 const migration=source('../migrations/0047_admin_profile_layouts.sql');
 assert.doesNotThrow(()=>new Function(app));
 assert.doesNotThrow(()=>new Function(ui));
 assert.match(api,/readPublishedProfileLayouts\(env.DB\)/);
 assert.match(admin,/handleProfileLayoutAdmin/);
 assert.match(ui,/P\.profileDesigner=async function/);
 assert.match(ui,/Save Draft/);
 assert.match(ui,/Publish to All/);
 assert.match(ui,/data-move/);
 assert.match(app,/profileLayout\(screen\)/);
 assert.match(app,/profile\?\.medal_style/);
 assert.match(app,/person\.name_tag_style/);
 assert.match(app,/data-sh-layout-ornament/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_profile_layouts/);
 assert.doesNotMatch(migration,/\b(?:DROP|DELETE|TRUNCATE)\b/i);
});
