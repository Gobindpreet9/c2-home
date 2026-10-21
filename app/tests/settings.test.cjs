'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Settings=require('../src/settings.js');
function memory(){const data={};return {getItem:k=>data[k]||null,setItem:(k,v)=>{data[k]=v;},removeItem:k=>{delete data[k];},data};}
test('defaults use approved appearance and candidate app IDs',()=>{const s=Settings.create(memory()).load();assert.equal(s.glass,true);assert.equal(s.details,true);assert.equal(s.apps.moonfin,'org.moonfin.webos');assert.equal(s.focus,'moonfin');});
test('appearance and focus persist and merge without wiping IDs',()=>{const st=memory(),s=Settings.create(st);s.save({glass:false,shade:22,focus:'ps5'});const c=Settings.create(st).load();assert.equal(c.glass,false);assert.equal(c.shade,22);assert.equal(c.focus,'ps5');assert.equal(c.apps.youtube,'youtube.leanback.v4');});
test('credentials and unknown fields are never persisted',()=>{const st=memory();Settings.create(st).save({password:'DO-NOT-SAVE',token:'DO-NOT-SAVE',session:{token:'DO-NOT-SAVE'},weather:{city:'City',latitude:44,longitude:-120,units:'fahrenheit',password:'DO-NOT-SAVE'}});assert.equal(JSON.stringify(st.data).includes('DO-NOT-SAVE'),false);assert.equal(Settings.create(st).load().weather.city,'City');});
test('malformed or hostile values fall back safely',()=>{const st=memory();st.setItem('c2-home-settings-v1','{broken');const x=Settings.create(st);assert.equal(x.load().glass,true);const v=x.save({shade:999,focus:'<script>',apps:{moonfin:'javascript:alert(1)'},weather:{latitude:999,longitude:'x',units:'kelvin'}});assert.equal(v.shade,55);assert.equal(v.focus,'moonfin');assert.equal(v.apps.moonfin,'org.moonfin.webos');assert.equal(v.weather.latitude,null);assert.equal(v.weather.units,'celsius');});
test('storage failure does not prevent using settings in memory',()=>{const s=Settings.create({getItem(){throw Error('denied')},setItem(){throw Error('denied')}});s.save({night:true});assert.equal(s.load().night,true);});
test('reset only removes its own namespace',()=>{const st=memory();st.setItem('unrelated','keep');const s=Settings.create(st);s.save({glass:false});assert.equal(s.reset().glass,true);assert.equal(st.getItem('unrelated'),'keep');});
test('unchanged sanitized settings skip redundant storage writes',()=>{
  const st=memory();let writes=0;const write=st.setItem;
  st.setItem=(...args)=>{writes++;write(...args);};
  const prefs=Settings.create(st);
  for(let i=0;i<100;i++)prefs.save({focus:'moonfin'});
  assert.equal(writes,0,'default focus already matches');
  prefs.save({focus:'ps5',weather:{city:'City'}});
  assert.equal(writes,1,'a real change writes immediately');
  for(const patch of [{focus:'ps5'},{weather:{city:'City'}},{},{password:'ignore'},{shade:3.1}])prefs.save(patch);
  assert.equal(writes,1,'only sanitized changes write');
  const reloaded=Settings.create(st);
  reloaded.save({focus:'ps5'});
  assert.equal(writes,1,'loaded settings also skip unchanged writes');
  assert.equal(reloaded.load().focus,'ps5');
  reloaded.reset();reloaded.save({focus:'moonfin'});
  assert.equal(writes,1,'reset baseline also skips unchanged writes');
});
test('failed focus flush retries without losing in-memory focus',()=>{
  const st=memory();const write=st.setItem;let attempts=0;
  st.setItem=(...args)=>{attempts++;if(attempts===1)throw Error('temporary storage failure');write(...args);};
  const prefs=Settings.create(st);
  prefs.save({focus:'pc'});prefs.flush();
  assert.equal(prefs.load().focus,'pc');
  prefs.flush();
  assert.equal(attempts,2,'flush retries an unsuccessful write');
  assert.equal(Settings.create(st).load().focus,'pc','successful flush persists the final focus');
});
test('focus-only saves coalesce in memory until explicit flush',()=>{
  const st=memory();let writes=0;const write=st.setItem;st.setItem=(...args)=>{writes++;write(...args);};
  const prefs=Settings.create(st),choices=['moonlight','youtube','pc','ps5','moonfin'];
  for(let i=0;i<24;i++){const focus=choices[i%choices.length];prefs.save({focus});assert.equal(prefs.load().focus,focus);}
  assert.equal(writes,0,'changing focus does not synchronously write storage');
  assert.equal(Settings.create(st).load().focus,'moonfin','unflushed state remains memory-only');
  assert.equal(prefs.flush().focus,'ps5');
  assert.equal(writes,1,'only the final focus is written');
  assert.equal(Settings.create(st).load().focus,'ps5');
  prefs.flush();assert.equal(writes,1,'clean flush is a no-op');
});
test('non-focus saves synchronously include pending focus and leave no extra flush work',()=>{
  const st=memory();let writes=0;const write=st.setItem;st.setItem=(...args)=>{writes++;write(...args);};
  const prefs=Settings.create(st);
  prefs.save({focus:'pc'});assert.equal(writes,0);
  prefs.save({night:true});assert.equal(writes,1);
  assert.equal(Settings.create(st).load().focus,'pc');
  assert.equal(Settings.create(st).load().night,true);
  prefs.flush();assert.equal(writes,1);
  prefs.save({focus:'ps5',shade:22});assert.equal(writes,2,'mixed patch is synchronous');
  assert.equal(Settings.create(st).load().focus,'ps5');
  assert.equal(Settings.create(st).load().shade,22);
  prefs.save({focus:'youtube'});prefs.save({night:true});
  assert.equal(writes,3,'unchanged non-focus setting still flushes pending focus');
  assert.equal(Settings.create(st).load().focus,'youtube');
  prefs.save({focus:'pc'});prefs.reset();prefs.flush();
  assert.equal(writes,3,'reset discards pending focus instead of resurrecting it');
  assert.equal(Settings.create(st).load().focus,'moonfin');
});
test('app IDs are explicit validated identifiers',()=>{assert.equal(Settings.validAppId('com.limelight.webos'),true);assert.equal(Settings.validAppId('bad id'),false);assert.equal(Settings.validAppId('../a'),false);assert.equal(Settings.validAppId('com.foo;sh'),false);});
