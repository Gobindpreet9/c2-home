'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../src/production.css'),'utf8');
function declarations(selector){
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rules=Array.from(css.matchAll(new RegExp('(?:^|})\\s*'+escaped+'\\s*\\{([^}]+)\\}','g')));
  const result={};
  for(const rule of rules)for(const pair of rule[1].split(';')){let i=pair.indexOf(':');if(i>=0)result[pair.slice(0,i).trim()]=pair.slice(i+1).trim();}
  return result;
}
test('TV secondary text has readable explicit sizes without fading metadata',()=>{
  assert.equal(declarations('.tv .app-meta')['font-size'],'19px');
  assert.equal(declarations('.tv .app-meta')['line-height'],'24px');
  assert.equal(declarations('.tv .app:not(.selected) .app-meta').opacity,'1');
  assert.equal(declarations('.tv .source small')['font-size'],'18px');
  assert.equal(declarations('.tv .library-mark')['font-size'],'18px');
});
test('TV text uses tight shadows rather than broad halos',()=>{
  assert.equal(declarations('.tv .clock-block')['text-shadow'],'0 2px 6px #07180b5c');
  assert.equal(declarations('.tv .top-actions')['text-shadow'],'0 1px 4px #07180b66');
});
test('label rhythm stays explicit while keeping the serif clock and artwork',()=>{
  assert.equal(declarations('.tv .app-name')['font-size'],'34px');
  assert.equal(declarations('.tv .app-name')['line-height'],'40px');
  assert.equal(declarations('.tv .source-name')['font-size'],'26px');
  assert.match(css,/\.clock,\.drawer h2,\.library-title\{font-family:C2Serif,Georgia,serif/);
  assert.doesNotMatch(css,/image-rendering\s*:\s*pixelated|-webkit-font-smoothing\s*:\s*none/);
});
