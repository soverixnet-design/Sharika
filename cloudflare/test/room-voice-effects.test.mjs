import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../app/royal-room-ui.js',import.meta.url),'utf8');
const functions=bridge.slice(bridge.indexOf('  const roomVoiceEffects=['),
  bridge.indexOf('  async function openRoomVoiceEffects'));

function audioNode(name){
  return {
    name,outputs:[],gain:{},frequency:{},delayTime:{},threshold:{},ratio:{},
    connect(target){this.outputs.push(target);return target;},
    disconnect(){this.outputs.length=0;},
    start(){this.started=true;},
    stop(){this.stopped=true;}
  };
}

test('verified SVIP gates effects at expiry, including 30-day memberships',()=>{
  const time=1700000000000, timers=[];
  const {svipVoiceAccess,watchRoomVoiceEffect}=runInNewContext(functions+
    '\n({svipVoiceAccess,watchRoomVoiceEffect});',{
    Date:{now:()=>time},svipLevel:Number,setTimeout:(_callback,delay)=>timers.push(delay),
    clearTimeout(){},setInterval:()=>1,clearInterval(){}
  });
  assert.equal(svipVoiceAccess({tier:'vip',svip_level:8}).level,0);
  assert.equal(svipVoiceAccess({tier:'svip',svip_level:8,expires_at_ms:time}).level,0);
  const access=svipVoiceAccess({tier:'svip',svip_level:8,expires_at_ms:time+30*86400000});
  assert.equal(access.level,8);
  watchRoomVoiceEffect({micMix:{}},4,access);
  assert.deepEqual(timers,[2147483647]);
});

test('robot and echo replace the mic path without rerouting shared music',()=>{
  const {setRoomVoiceEffect}=runInNewContext(functions+'\n({setRoomVoiceEffect});',{});
  const source=audioNode('mic'),micGain=audioNode('micGain');
  const destination=audioNode('sender'),song=audioNode('song');
  song.connect(destination);micGain.connect(destination);
  const mix={source,micGain,effectNodes:[],context:{
    createBiquadFilter:()=>audioNode('filter'),
    createGain:()=>audioNode('gain'),
    createDelay:()=>audioNode('delay'),
    createOscillator:()=>audioNode('oscillator')
  }};
  setRoomVoiceEffect(mix,'robot');
  const robot=mix.oscillator;
  assert.equal(robot.started,true);
  assert.equal(source.outputs.length,1);
  assert.equal(source.outputs[0].type,'highpass');
  setRoomVoiceEffect(mix,'echo');
  assert.equal(robot.stopped,true);
  assert.deepEqual(source.outputs,[micGain,mix.effectNodes[0]]);
  assert.equal(mix.effectNodes[0].delayTime.value,.16);
  setRoomVoiceEffect(mix,'normal');
  assert.deepEqual(source.outputs,[micGain]);
  assert.deepEqual(song.outputs,[destination]);
  assert.deepEqual(micGain.outputs,[destination]);
});

test('room effects use the connected publisher and retain immediate mic mute',()=>{
  assert.match(ui,/Voice Effects', \(\) =>/);
  assert.match(ui,/effects\.open\(window\)/);
  assert.match(bridge,/!state\.readyPublication\|\|!state\.canPublish/);
  assert.match(bridge,/track\.enabled=!track\.enabled;\s*if\(sfuState\.micMix\)sfuState\.micMix\.micGain\.gain\.value=track\.enabled\?1:0/);
  assert.match(bridge,/const next=context\.state==='running'\?mixed:mic/);
  assert.match(bridge,/if\(state\.micMix\)closeMicMix\(state\.micMix\)/);
});
