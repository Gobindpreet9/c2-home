'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const app=path.join(__dirname,'..');
// Build production transforms without touching the parent's dist/homeapp artifacts.
const out=fs.mkdtempSync(path.join(os.tmpdir(),'c2-input-test-'));
after(()=>fs.rmSync(out,{recursive:true,force:true}));
execFileSync('python3',['-c',"import pathlib,runpy,sys; m=runpy.run_path(sys.argv[1]); m['build'].__globals__['OUT']=pathlib.Path(sys.argv[2]); m['build']()",path.join(app,'build_app.py'),out],{cwd:app,stdio:'pipe'});
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
function functionLine(name){const match=html.match(new RegExp('^function '+name+'\\([^\\n]+','m'));assert.ok(match,name+' exists');return match[0];}
function launcher(){
  const counts={adds:0,removes:0,queries:0,saves:0,focuses:0,activations:0,settings:0};
  function classes(initial){const values=new Set(initial);return {contains:k=>values.has(k),add(k){if(k==='selected')counts.adds++;values.add(k);},remove(k){if(k==='selected')counts.removes++;values.delete(k);}};}
  const nodes=['moonfin','moonlight','youtube'].map((id,col)=>({dataset:{id,row:'0',col:String(col)},classList:classes(col===1?['app','selected']:['app']),closest:()=>null,getClientRects:()=>[{}],focus(){counts.focuses++;context.document.activeElement=this;},matches:()=>false}));
  const context={counts,nodes,selected:nodes[1],lastApp:nodes[1],shelfOpen:false,art:false,settingsOpen:false,tv:{classList:classes(['idle'])},document:{activeElement:nodes[1],querySelectorAll(selector){if(selector==='#interface .selected')counts.queries++;return selector==='#interface .selected'?nodes.filter(n=>n.classList.contains('selected')):nodes;},addEventListener(type,handler){assert.equal(type,'keydown');context.keydown=handler;}},save(){counts.saves++;},activate(){counts.activations++;},setSettings(){counts.settings++;},setShelf(){throw Error('unexpected shelf action');},setArt(){throw Error('unexpected art action');}};
  vm.createContext(context);
  vm.runInContext(functionLine('wake')+'\n'+functionLine('select')+'\n'+html.slice(html.indexOf('function move('),html.indexOf('function updateClock(')),context);
  vm.runInContext(html.slice(html.indexOf("document.addEventListener('keydown'"),html.indexOf("window.addEventListener('blur'")),context);
  context.press=(key,keyCode)=>{const event={key,keyCode,prevented:false,preventDefault(){this.prevented=true;}};context.keydown(event);return event;};
  return context;
}
function persistence(){
  const data={},writes=[],events={document:{},window:{}};
  const storage={getItem:k=>data[k]||null,setItem(k,v){writes.push({k,v});data[k]=v;},removeItem:k=>{delete data[k];}};
  const Settings=require(path.join(out,'settings.js'));
  const context={C2Settings:Settings,window:{localStorage:storage,addEventListener(type,fn){(events.window[type]||= []).push(fn);}},document:{hidden:false,addEventListener(type,fn){(events.document[type]||= []).push(fn);}},setTimeout(){throw Error('persistence must not schedule timers');},setInterval(){throw Error('persistence must not schedule timers');}};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('var safeStore;'),html.indexOf('function save(')),context);
  return {context,prefs:context.window.C2Prefs,writes,reload:()=>Settings.create(storage).load(),emit(target,type){for(const fn of events[target][type]||[])fn();}};
}
test('focus persists on hidden visibility and pagehide without timers',()=>{
  const fixture=persistence();
  fixture.prefs.save({focus:'ps5'});
  fixture.emit('document','visibilitychange');assert.equal(fixture.writes.length,0,'visible does not flush');
  fixture.context.document.hidden=true;fixture.emit('document','visibilitychange');
  assert.equal(fixture.writes.length,1,'hidden flushes pending focus');
  assert.equal(fixture.reload().focus,'ps5');
  fixture.prefs.save({focus:'pc'});fixture.emit('window','pagehide');
  assert.equal(fixture.writes.length,2,'pagehide independently flushes pending focus');
  assert.equal(fixture.reload().focus,'pc');
  fixture.emit('window','pagehide');fixture.emit('document','visibilitychange');
  assert.equal(fixture.writes.length,2,'repeated lifecycle events do not rewrite');
});
test('native launch flushes final focus before device handoff',async()=>{
  const fixture=persistence(),context=fixture.context;
  let calls=0;
  Object.assign(context,{launching:false,disposed:false,notify(){},device:{launch(action){calls++;assert.equal(action,'moonfin');assert.equal(fixture.reload().focus,'ps5','focus is durable before launch');return Promise.resolve(true);}}});
  const runtime=fs.readFileSync(path.join(out,'runtime.js'),'utf8');
  vm.runInContext(runtime.match(/^function launch\(action,params\)[^\n]+/m)[0],context);
  fixture.prefs.save({focus:'ps5'});
  assert.equal(fixture.writes.length,0);
  assert.equal(await context.launch('moonfin'),true);
  assert.equal(calls,1);assert.equal(fixture.writes.length,1);
  fixture.emit('window','pagehide');assert.equal(fixture.writes.length,1,'subsequent hide is clean');
});
test('idle directional keys wake and act on that same keypress',()=>{
  for(const [key,keyCode,want] of [['ArrowLeft',37,'moonfin'],['ArrowRight',39,'youtube'],['ArrowUp',38,'moonfin'],['ArrowDown',40,'youtube'],['',37,'moonfin'],['',39,'youtube'],['',38,'moonfin'],['',40,'youtube']]){
    const ui=launcher();
    if(keyCode===38||keyCode===40)ui.nodes.forEach((node,i)=>{node.dataset.row=String(i+2);node.dataset.col='0';});
    const event=ui.press(key,keyCode);
    assert.equal(ui.tv.classList.contains('idle'),false);
    assert.equal(ui.selected.dataset.id,want,key||String(keyCode));
    assert.equal(event.prevented,true);
    assert.equal(ui.counts.activations,0);
  }
});
test('idle OK and other non-directional keys remain wake-only',()=>{
  for(const [key,code] of [['Enter',13],['',13],['Escape',27],['',461],['r',403],['x',88]]){
    const ui=launcher();const event=ui.press(key,code);
    assert.equal(ui.tv.classList.contains('idle'),false);
    assert.equal(ui.selected,ui.nodes[1]);
    assert.equal(ui.counts.activations,0);
    assert.equal(ui.counts.settings,0);
    assert.equal(event.prevented,true);
  }
  const ui=launcher();ui.press('Enter',13);ui.press('Enter',13);
  assert.equal(ui.counts.activations,1,'a second OK activates normally');
});
test('repeated selection avoids selection DOM mutations and focus saves',()=>{
  const ui=launcher();
  for(let i=0;i<100;i++)ui.select(ui.selected,false);
  assert.equal(ui.counts.adds,0,'selected class additions');
  assert.equal(ui.counts.removes,0,'selected class removals');
  assert.equal(ui.counts.queries,0,'selected-node queries');
  assert.equal(ui.counts.saves,0,'focus save calls');
  assert.equal(ui.counts.focuses,0);
  ui.document.activeElement=ui.nodes[0];ui.select(ui.selected,true);
  assert.equal(ui.document.activeElement,ui.selected,'explicit focus still restores DOM focus');
});
test('eight boundary Left presses perform no selection mutations or storage writes',()=>{
  const ui=launcher(),fixture=persistence();ui.prefs=fixture.prefs;
  vm.runInContext(functionLine('save'),ui);
  ui.select(ui.nodes[0],true);
  for(const key of Object.keys(ui.counts))ui.counts[key]=0;
  for(let i=0;i<8;i++)ui.press('ArrowLeft',37);
  assert.equal(ui.selected.dataset.id,'moonfin');
  assert.equal(ui.counts.adds,0);assert.equal(ui.counts.removes,0);assert.equal(ui.counts.queries,0);
  assert.equal(fixture.writes.length,0);
});
test('HDMI focus survives a shelf trip and persists when hidden',()=>{
  const ui=launcher(),fixture=persistence();ui.prefs=fixture.prefs;
  vm.runInContext(functionLine('save'),ui);
  const hdmi=ui.nodes[0];delete hdmi.dataset.id;hdmi.dataset.device='pc';hdmi.classList.remove('app');hdmi.classList.add('source');
  ui.select(hdmi,true);assert.equal(ui.lastApp,hdmi);
  const shelf=ui.nodes[2];shelf.classList.remove('app');ui.select(shelf,true);ui.select(ui.lastApp,true);
  assert.equal(fixture.prefs.load().focus,'pc');assert.equal(fixture.writes.length,0);
  fixture.context.document.hidden=true;fixture.emit('document','visibilitychange');
  assert.equal(fixture.reload().focus,'pc');assert.equal(fixture.writes.length,1);
});
test('native-size root clears identity scale and still scales and centers other viewports',()=>{
  const context={tv:{style:{transform:'scale(0.5)'}},frame:{clientWidth:1920,clientHeight:1080}};
  vm.createContext(context);vm.runInContext(functionLine('fit'),context);
  for(const [width,height,transform,left,top] of [[1920,1080,'','0px','0px'],[960,540,'scale(0.5)','0px','0px'],[1600,1080,'scale(0.8333333333333334)','0px','90px'],[1920,1200,'','0px','60px'],[3840,2160,'scale(2)','0px','0px'],[1920,1080,'','0px','0px']]){
    context.frame.clientWidth=width;context.frame.clientHeight=height;context.fit();
    assert.equal(context.tv.style.transform,transform,width+'x'+height);
    assert.equal(context.tv.style.left,left);
    assert.equal(context.tv.style.top,top);
  }
});
