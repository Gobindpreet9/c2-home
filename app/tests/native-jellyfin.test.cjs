'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Settings=require('../src/settings.js');
const session={url:'http://192.0.2.10:8096',token:'0123456789abcdef0123456789abcdef',userId:'00000000-0000-4000-8000-000000000001',userName:'Example User'};
const KEY='org.orca.c2home.jellyfin.v1';
function bridgeFactory(disk,log){return()=>({cancel(){},call(uri,raw){const data=JSON.parse(raw);log.push({uri,data});if(uri.endsWith('/setPreferences'))Object.assign(disk,data);const result=uri.endsWith('/getPreferences')?{returnValue:true,[KEY]:disk[KEY]}:{returnValue:true};queueMicrotask(()=>this.onservicecallback(JSON.stringify(result)));}});}
test('Jellyfin session round-trips through native preferences without a password',async()=>{
 const disk={},log=[],store=Settings.createJellyfinStore(bridgeFactory(disk,log));
 assert.equal(await store.load(),null);
 const saved=await store.save({...session,password:'must-not-be-written'});
 assert.deepEqual(saved,session);assert.deepEqual(disk,{[KEY]:session});
 const restarted=Settings.createJellyfinStore(bridgeFactory(disk,log));assert.deepEqual(await restarted.load(),session);
 assert.ok(log.every(r=>Object.keys(r.data).every(k=>k===KEY||k==='keys')));
});
test('invalid or hostile sessions are refused before touching the preference',async()=>{
 const disk={},log=[],store=Settings.createJellyfinStore(bridgeFactory(disk,log));
 for(const bad of [null,{}, {...session,token:''}, {...session,token:'short'}, {...session,token:'bad token with spaces'}, {...session,userId:''}, {...session,url:'javascript:alert(1)'}, {...session,url:'http://user:pass@host'}]) {
  await assert.rejects(store.save(bad),/Invalid Jellyfin session/);
 }
 assert.deepEqual(disk,{});assert.equal(log.length,0);
});
test('signing out clears the native session',async()=>{
 const disk={[KEY]:session},log=[],store=Settings.createJellyfinStore(bridgeFactory(disk,log));
 assert.deepEqual(await store.load(),session);
 assert.equal(await store.clear(),true);
 assert.deepEqual(disk,{[KEY]:{}});assert.equal(await store.load(),null);
});
