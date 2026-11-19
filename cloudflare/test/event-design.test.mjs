import test from 'node:test';
import assert from 'node:assert/strict';
import {ROYAL_EVENT_TEMPLATES,EVENT_SCORING_MODES,safeEventTemplate,
 validEventDesignFields,safeEventScoring} from '../src/event-design.mjs';
import {validEventPayload,handleEventApp,handleEventAdmin} from '../src/events.mjs';

const event={title:'Royal CP Love',kind:'festival',description:'Verified event',
 starts_at:'2026-11-23T00:00:00.000Z',ends_at:'2026-11-26T00:00:00.000Z',
 status:'draft',prizes:[100,50,25],
 template_id:'cp_love',scoring_mode:'cp_gifts'};
test('exactly five safe built-in event templates and three truthful ranking modes',()=>{
 assert.deepEqual(Object.keys(ROYAL_EVENT_TEMPLATES),
  ['royal_gold','diamond_luxury','game_tournament','cp_love','festival_special']);
 assert.deepEqual(Object.keys(EVENT_SCORING_MODES),['gift_points','game_wins','cp_gifts']);
 assert.equal(safeEventTemplate('__proto__'),'royal_gold');
 assert.equal(safeEventTemplate('<script>'),'royal_gold');
 assert.equal(safeEventScoring('manual_winner'),'gift_points');
});
test('valid templates are editable while unknown injected styles or scoring are rejected',()=>{
 assert.equal(validEventPayload(event),true);
 assert.equal(validEventPayload({...event,template_id:'custom-css-injection'}),false);
 assert.equal(validEventPayload({...event,scoring_mode:'client_reported_wins'}),false);
 assert.equal(validEventPayload({...event,template_id:'diamond_luxury',
  scoring_mode:'game_wins'}),true);
 assert.equal(validEventDesignFields({}),true);
});
function envForRanking(scoring_mode){
 const queries=[];
 const db={prepare(sql){
  return {args:[],bind(...args){this.args=args;return this;},
   async first(){
    if(sql.includes('SELECT published FROM sharika_center_publishing'))
      return {published:1};
    if(sql.includes('SELECT public_no FROM sharika_users WHERE auth_uid'))
      return {public_no:10000001};
    if(sql.includes('FROM sharika_events WHERE id'))
      return {id:5,status:'published',starts_at:'2026-11-23T00:00:00.000Z',
       ends_at:'2026-11-26T00:00:00.000Z',gift_rules_json:'[]',scoring_mode};
    return null;
   },
   async all(){
    queries.push({sql,args:this.args});
    if(sql.includes('FROM sharika_wallet_ledger'))return {results:[{
     public_no:10000001,name:'Gamer',pic:null,points:250,gift_count:1}]};
    if(sql.includes('FROM sharika_bond_gift_events'))return {results:[{
     bond_id:3,a_no:10000001,a_name:'First',a_pic:null,
     b_no:10000002,b_name:'Second',b_pic:null,points:400,gift_count:2}]};
    return {results:[]};
   }};
 }};
 return {env:{DB:db},queries};
}
const reply=(d,status=200)=>Response.json(d,{status});
const fail=(error,status)=>Response.json({error},{status});
test('each Game Event ranks only confirmed virtual coin wins within event UTC boundaries',async()=>{
 const {env,queries}=envForRanking('game_wins');
 const result=await handleEventApp({request:new Request('https://test/events/5/ranking'),
  env,uid:'member',path:'/api/v1/events/5/ranking',cors:{},reply,fail});
 assert.equal(result.status,200);
 const body=await result.json();
 assert.equal(body.scoring,'game_wins');
 assert.equal(body.ranking[0].points,250);
 const query=queries.find(q=>q.sql.includes('FROM sharika_wallet_ledger'));
 assert.ok(query);
 assert.match(query.sql,/l\.reason IN/);
 assert.deepEqual(query.args,['2026-11-23 00:00:00','2026-11-26 00:00:00']);
});
test('CP Event returns genuine paired ranking, never a fabricated single winner',async()=>{
 const {env,queries}=envForRanking('cp_gifts');
 const result=await handleEventApp({request:new Request('https://test/events/5/ranking'),
  env,uid:'member',path:'/api/v1/events/5/ranking',cors:{},reply,fail});
 assert.equal(result.status,200);
 const body=await result.json();
 assert.equal(body.scoring,'cp_gifts');
 assert.equal(body.ranking[0].public_id,'10000001 / 10000002');
 assert.equal(body.ranking[0].name,'First ♡ Second');
 assert.equal(body.ranking[0].points,400);
 const q=queries.find(q=>q.sql.includes('FROM sharika_bond_gift_events'));
 assert.ok(q);
 assert.deepEqual(q.args,[Date.parse('2026-11-23T00:00:00Z'),
  Date.parse('2026-11-26T00:00:00Z')]);
});
