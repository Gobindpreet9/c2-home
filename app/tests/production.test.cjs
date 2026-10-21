'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..','dist');
test('real TV build exists with app metadata and no simulated launch handler',()=>{const h=fs.readFileSync(path.join(root,'index.html'),'utf8');const info=JSON.parse(fs.readFileSync(path.join(root,'appinfo.json')));assert.equal(info.id,'org.orca.c2home');assert.equal(info.main,'index.html');assert.deepEqual(info.requiredACG,['application.launcher','application.query']);assert.equal(h.includes('Preview only —'),false);assert.equal(h.includes('window.C2Runtime.launchElement(el)'),true);assert.equal(h.includes('src="runtime.js"'),true);});
test('package source has no node tooling or dependency tree',()=>{assert.equal(fs.existsSync(path.join(root,'node_modules')),false);for(const f of ['settings.js','device.js','connections.js','runtime.js','production.css','icon.png','large-icon.png','LiberationSerif-Regular.ttf','LiberationSerif-OFL.txt'])assert.equal(fs.statSync(path.join(root,f)).isFile(),true,f);});
test('bundled wallpaper is a real local image and only theme metadata is embedded',()=>{const h=fs.readFileSync(path.join(root,'index.html'),'utf8');const match=h.match(/id="wallpaper" src="([^"]+)"/);assert.ok(match);assert.equal(match[1].startsWith('wallpaper.'),true);assert.ok(fs.statSync(path.join(root,match[1])).size>10000);assert.equal(h.includes('__THEME_JSON__'),false);assert.equal(h.includes('data:image/jpeg;base64'),false);});
