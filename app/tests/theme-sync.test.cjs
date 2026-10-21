'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'theme-sync.js'), 'utf8');

function fakeTimers(){
  let next=1;
  const pending=new Map();
  return {
    setTimeout(fn,ms){const id=next++;pending.set(id,fn);return id;},
    clearTimeout(id){pending.delete(id);},
    runAll(){for(const [id,fn] of Array.from(pending)){pending.delete(id);fn();}},
    pending
  };
}

function harness(themeData, config){
  const applied=[];
  const wallpapers=[];
  const fetches=[];
  const streams=[];
  const timers=fakeTimers();
  const elements={
    tv:{style:{values:{},setProperty(k,v){this.values[k]=v;}},dataset:{}},
    wallpaper:{src:''},
    wallpaperNext:{hidden:true,src:'',classList:{values:[],add(v){this.values.push(v);},remove(v){this.values=this.values.filter(x=>x!==v);}}},
    themeState:{textContent:''}
  };
  const document={getElementById(id){return elements[id]||null;}};
  const window={
    document,
    setTimeout:timers.setTimeout,
    clearTimeout:timers.clearTimeout,
    localStorage:null,
    URL:{createObjectURL:()=>'blob:test',revokeObjectURL(){}}
  };
  class FakeEventSource{
    constructor(url){this.url=url;this.listeners={};this.closed=false;streams.push(this);}
    addEventListener(name,fn){(this.listeners[name]||(this.listeners[name]=[])).push(fn);}
    emit(name,data){(this.listeners[name]||[]).forEach(fn=>fn({data:JSON.stringify(data)}));}
    close(){this.closed=true;}
  }
  const fetch=async(url)=>{
    fetches.push(url);
    if(url.includes('/api/theme')){
      return {ok:true,json:async()=>themeData};
    }
    return {ok:true,blob:async()=>new Blob([new Uint8Array([1,2,3])])};
  };
  const context={console,Promise,Date,Math,JSON,Blob,Uint8Array,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout};
  context.window=context;
  context.URL={createObjectURL:()=>'blob:test',revokeObjectURL(){}};
  vm.createContext(context);
  vm.runInContext(source,context);
  const sync=context.C2ThemeSync.create({
    config:config===undefined?{urls:['http://pc:8790'],token:'t'}:config,
    fetch,EventSource:FakeEventSource,document,window:context,timers,
    onApply:data=>applied.push(data),
    onWallpaper:(url,data)=>wallpapers.push({url,data})
  });
  return {sync,applied,wallpapers,fetches,streams,timers,elements};
}

async function flush(){for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));}

const theme={theme:'lupine',accent:'#3264eb',foreground:'#212121',background:'#fafafa',mode:'light',version:'v1',wallpaperVersion:'w1',wallpaper:'/api/wallpaper?v=w1'};

test('initial fetch applies palette and opens one stream', async()=>{
  const h=harness(theme);
  h.sync.start();
  await flush();
  assert.equal(h.applied.length,1);
  assert.equal(h.applied[0].accent,'#3264eb');
  assert.equal(h.streams.length,1);
  assert.match(h.streams[0].url,/\/events\?token=t$/);
  assert.equal(h.elements.tv.style.values['--accent'],'#3264eb');
  assert.match(h.elements.tv.style.values['--ink'],/^rgb\(\d+,\d+,\d+\)$/);
  assert.match(h.elements.tv.style.values['--selected-fill-a'],/^rgba\(\d+,\d+,\d+,/);
  assert.match(h.elements.tv.style.values['--selected-ink'],/^#[0-9a-f]{6}$/);
  assert.doesNotMatch(JSON.stringify(h.elements.tv.style.values),/NaN/);
  assert.equal(h.sync.getState().status,'live');
  assert.equal(h.wallpapers.length,1);
});

test('SSE changes apply once and identical versions do not re-render', async()=>{
  const h=harness(theme);
  h.sync.start();
  await flush();
  const changed={...theme,accent:'#ff8800',version:'v2',wallpaperVersion:'w2'};
  h.streams[0].emit('theme',changed);
  await flush();
  assert.equal(h.elements.tv.style.values['--accent'],'#ff8800');
  assert.equal(h.applied.length,2);
  const before=h.applied.length;
  h.streams[0].emit('theme',changed);
  await flush();
  assert.equal(h.applied.length,before);
  assert.equal(h.wallpapers.length,2);
});

test('palette-only changes do not fetch the wallpaper again', async()=>{
  const h=harness(theme);
  h.sync.start();
  await flush();
  h.streams[0].emit('theme',{...theme,accent:'#00aa88',version:'v2'});
  await flush();
  assert.equal(h.wallpapers.length,1);
  assert.equal(h.applied.length,2);
});

test('hiding Home closes the stream and showing fetches once', async()=>{
  const h=harness(theme);
  h.sync.start();
  await flush();
  h.sync.setVisible(false);
  assert.equal(h.streams[0].closed,true);
  assert.equal(h.sync.getState().status,'paused');
  const count=h.fetches.length;
  h.sync.setVisible(true);
  await flush();
  assert.equal(h.fetches.length,count+1);
  assert.equal(h.streams.length,2);
});

test('a failed stream schedules a bounded retry', async()=>{
  const h=harness(theme);
  h.sync.start();
  await flush();
  h.streams[0].onerror();
  await flush();
  assert.equal(h.sync.getState().status,'unavailable');
  assert.ok(h.sync.getState().error);
  const before=h.fetches.length;
  h.timers.runAll();
  await flush();
  assert.equal(h.fetches.length,before+1);
});

test('missing configuration stays offline', async()=>{
  const h=harness(theme,{urls:[],token:''});
  h.sync.start();
  await flush();
  assert.equal(h.fetches.length,0);
  assert.equal(h.sync.getState().status,'disabled');
  assert.equal(h.elements.themeState.textContent,'Not configured');
});
