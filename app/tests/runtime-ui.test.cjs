'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/runtime.js'),'utf8');
function functionLine(name){const m=source.match(new RegExp('^function '+name+'\\([^\\n]+','m'));assert.ok(m);return m[0];}
function node(){return {textContent:'',value:'',hidden:true,dataset:{},firstChild:null,children:[],style:{},setAttribute(){},addEventListener(){},appendChild(n){this.children.push(n);this.firstChild=this.children[0];},removeChild(){this.children.pop();this.firstChild=this.children[0]||null;},classList:{toggle(){}}};}
test('settings shows the saved weather city immediately and prefills its search',()=>{
 const nodes={},states=[node(),node()];states[1].textContent='Not set';
 const cfg=require('../src/settings.js').defaults();cfg.weather={city:'Example City',latitude:10.25,longitude:20.5,units:'celsius'};
 const ctx={cfg,tv:{classList:{toggle(){},contains(){return true}},style:{setProperty(){}}},ui:{setNight(){},select(){}},el:id=>(nodes[id]||=node()),document:{querySelectorAll:()=>states}};
 vm.runInNewContext(functionLine('apply')+';apply();',ctx);
 assert.equal(states[1].textContent,'Example City');
 assert.equal(nodes.cityQuery.value,'Example City');
 assert.equal(nodes.weatherUnits.value,'celsius');
});
test('library refresh is only exposed while a Jellyfin session exists',()=>{
 const nodes={},mark=node();
 const ctx={session:null,shelves:{items:[]},renderVersion:0,version:0,releaseArt(){},el:id=>(nodes[id]||=node()),document:{querySelector:s=>s==='.library-mark'?mark:node(),querySelectorAll:()=>[]}};
 nodes.refreshLibrary=node();vm.createContext(ctx);vm.runInContext(functionLine('renderShelf'),ctx);
 ctx.renderShelf(true);assert.equal(nodes.refreshLibrary.hidden,true);
 ctx.session={};ctx.renderShelf(true);assert.equal(nodes.refreshLibrary.hidden,false);
 ctx.session=null;ctx.renderShelf(true);assert.equal(nodes.refreshLibrary.hidden,true);
});
test('shelf cards pass their item id to the Moonfin launch',()=>{
 assert.match(source,/launch\('moonfin',\{itemId:item\.id\}\)/);
 assert.match(source,/Open '\+item\.title\+' in Moonfin\./);
});
test('the merged Continue watching shelf shows at most three items',()=>{
 const root=node(),nodes={shelfItems:root,refreshLibrary:node(),connect:node()};
 const items=[1,2,3,4,5].map(i=>({id:'i'+i,title:'Title '+i,subtitle:'S1 E'+i,progress:i}));
 const ctx={session:{},shelves:{items},renderVersion:-1,version:0,artUrls:[],artAborts:[],releaseArt(){},el:id=>(nodes[id]||=node()),launch(){},document:{createElement:()=>node(),querySelector:()=>node(),querySelectorAll:()=>[]}};
 vm.createContext(ctx);vm.runInContext(functionLine('renderShelf'),ctx);ctx.renderShelf(true);
 assert.equal(root.children.length,3);
 const copies=root.children.map(n=>n.children[0]);assert.deepEqual(copies.map(c=>c.children[0].textContent),['Continue','Continue','Continue']);assert.deepEqual(copies.map(c=>c.children[1].textContent),['Title 1','Title 2','Title 3']);
});
test('startup restores native weather without depending on browser local storage',async()=>{
 assert.match(source,/function restoreWeather\(/);
 const nodes={},states=[node(),node()],prefs=require('../src/settings.js').create(null);
 const weather={city:'Example City',latitude:10.25,longitude:20.5,units:'celsius'};let refreshed=0;
 const ctx={prefs,cfg:prefs.load(),weatherStore:{load:async()=>weather},weatherRevision:0,weatherRestoreState:'loading',disposed:false,visible:true,refreshWeather(){refreshed++;return Promise.resolve(true)},el:id=>(nodes[id]||=node()),document:{querySelectorAll:()=>states}};
 vm.createContext(ctx);vm.runInContext(functionLine('restoreWeather'),ctx);
 assert.equal(await ctx.restoreWeather(),true);assert.deepEqual(ctx.cfg.weather,weather);assert.equal(nodes.cityQuery.value,'Example City');assert.equal(states[1].textContent,'Example City');assert.equal(refreshed,1);
 let resolve;ctx.weatherStore.load=()=>new Promise(r=>{resolve=r});const pending=ctx.restoreWeather();ctx.weatherRevision++;const current=ctx.cfg.weather;resolve({...weather,city:'Stale city'});assert.equal(await pending,false);assert.equal(ctx.cfg.weather,current);
});
test('weather edits save a complete native location and refresh without blocking',async()=>{
 assert.match(source,/function saveWeatherSettings\(/);
 const nodes={},states=[node(),node()],prefs=require('../src/settings.js').create(null);
 prefs.save({weather:{city:'Example City',latitude:10.25,longitude:20.5,units:'celsius'}});let saved,refreshed=0;
 const ctx={prefs,cfg:prefs.load(),weatherStore:{save:async w=>{saved=w;return w}},weatherRevision:0,weatherRestoreState:'local',visible:true,notify(){throw Error('unexpected failure')},refreshWeather(){refreshed++},el:id=>(nodes[id]||=node()),document:{querySelectorAll:()=>states}};
 vm.createContext(ctx);vm.runInContext(functionLine('saveWeatherSettings'),ctx);
 const result=ctx.saveWeatherSettings({units:'fahrenheit'});assert.equal(refreshed,1);assert.equal(await result,true);
 assert.equal(saved.city,'Example City');assert.equal(saved.units,'fahrenheit');assert.equal(saved.latitude,10.25);assert.equal(ctx.weatherRevision,1);
 assert.match(source,/saveWeatherSettings\(\{city:city\.name/);assert.match(source,/saveWeatherSettings\(\{units:this\.value\}\)/);
});
test('startup restores a saved Jellyfin session and loads its shelves',async()=>{
 assert.match(source,/function restoreJellyfin\(/);
 const saved={url:'http://192.0.2.10:8096',token:'0123456789abcdef0123456789abcdef',userId:'00000000-0000-4000-8000-000000000001',userName:'Example User'};
 const states=[node(),node()],nodes={},mark=node();
 const prefs=require('../src/settings.js').create(null);let refreshed=0,cleared=0;
 const ctx={session:null,sessionEpoch:0,disposed:false,shelves:{items:[]},version:0,lastLibrary:0,releaseArt(){},prefs,cfg:prefs.load(),jellyfinStore:{load:async()=>saved,save:async()=>saved,clear:async()=>{cleared++;return true}},refreshLibrary(){refreshed++;return Promise.resolve(true)},renderShelf(){},el:id=>(nodes[id]||=node()),document:{querySelectorAll:()=>states,querySelector:s=>s==='.library-mark'?mark:node()}};
 vm.createContext(ctx);vm.runInContext(functionLine('markConnected')+'\n'+functionLine('forgetJellyfin')+'\n'+functionLine('restoreJellyfin'),ctx);
 assert.equal(await ctx.restoreJellyfin(),true);assert.deepEqual(ctx.session,saved);assert.equal(refreshed,1);assert.equal(states[0].textContent,'Connected');assert.equal(ctx.cfg.jellyfin.url,saved.url);
 ctx.sessionEpoch++;ctx.session=null;ctx.restoreJellyfin();assert.equal(ctx.session,null,'a late restore must not revive a stale session');
 ctx.session={};ctx.forgetJellyfin();assert.equal(ctx.session,null);assert.equal(cleared,1);assert.equal(states[0].textContent,'Not connected');
 assert.match(source,/jellyfinStore\.save\(value\)/);assert.match(source,/if\(error\.code==='AUTH'\)\{forgetJellyfin\(\)/);
});
