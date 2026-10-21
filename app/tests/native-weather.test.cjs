'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Settings=require('../src/settings.js');
const weather={city:'Example City',latitude:10.25,longitude:20.5,units:'celsius'};
const KEY='org.orca.c2home.weather.v1';
test('native weather preferences survive independent browser settings instances',async()=>{
 assert.equal(typeof Settings.createWeatherStore,'function');
 const disk={},requests=[];let cancelled=0;
 const factory=()=>({cancel(){cancelled++},call(uri,raw){const data=JSON.parse(raw);requests.push({uri,data});if(uri.endsWith('/setPreferences'))Object.assign(disk,data);const result=uri.endsWith('/getPreferences')?{returnValue:true,[KEY]:disk[KEY]}:{returnValue:true};queueMicrotask(()=>this.onservicecallback(JSON.stringify(result)));}});
 const first=Settings.createWeatherStore(factory);assert.equal(await first.load(),null);
 assert.deepEqual(await first.save({...weather,password:'not-persisted'}),weather);
 const restarted=Settings.createWeatherStore(factory);assert.deepEqual(await restarted.load(),weather);
 assert.deepEqual(disk,{[KEY]:weather});
 assert.ok(requests.every(r=>Object.keys(r.data).every(k=>k===KEY||k==='keys')));
 assert.equal(cancelled,requests.length);
});
