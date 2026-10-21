'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('focus and shelf motion share the easing system and stay optional',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/production.css'),'utf8');
 assert.match(css,/--motion-med:220ms/);
 assert.match(css,/\.tv \.app\{transition:transform var\(--motion-med\)/);
 assert.match(css,/\.tv \.dock-area\{transition:transform 260ms/);
 assert.match(css,/\.tv \.media-item:focus\{transform:translateY\(-2px\)\}/);
 const base=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
 assert.match(base,/@media\(prefers-reduced-motion:reduce\)/);
});
