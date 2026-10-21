'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const app=path.join(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'c2-cleanup-test-'));
after(()=>fs.rmSync(out,{recursive:true,force:true}));
execFileSync('python3',['-c',"import pathlib,runpy,sys; m=runpy.run_path(sys.argv[1]); m['build'].__globals__['OUT']=pathlib.Path(sys.argv[2]); m['build']()",path.join(app,'build_app.py'),out],{cwd:app,stdio:'pipe'});
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
test('Home keeps useful controls without theme badges, duplicate Home or helper copy',()=>{
 const home=html.slice(html.indexOf('<div class="interface"'),html.indexOf('<button class="art-return"'));
 assert.doesNotMatch(home,/id="themeCaption"|id="lgHome"|id="shelfHint"|class="footer-right"|class="app-meta"/);
 assert.doesNotMatch(home,/One press away|Official LG app|Launcher settings|Everforest|Play from your PC/);
 assert.match(home,/id="settings"[^>]*aria-label="Settings"/);
 assert.match(home,/id="libraryToggle"/);
 assert.match(home,/id="wallpaper"|class="dock"/);
 assert.match(home,/HDMI 1/);assert.match(home,/HDMI 2/);
 assert.doesNotMatch(html,/getElementById\('shelfHint'\)|getElementById\('themeCaption'\)|getElementById\('drawerTheme'\)/);
});
test('selected app tiles do not draw a decorative arrow',()=>{
 assert.doesNotMatch(html,/\.app\.selected::after/);
});
test('settings exposes two useful tabs and keeps technical forms behind Advanced',()=>{
 const drawer=html.slice(html.indexOf('<div class="scrim"'),html.indexOf('<div class="toast"'));
 assert.match(drawer,/<h3>PC theme<\/h3>/);
 assert.match(drawer,/id="themeState"[^>]*aria-live="polite"/);
 assert.match(drawer,/id="themeRefresh">Sync now<\/button>/);
 assert.match(html,/src="theme-config\.js"/);
 assert.match(html,/src="theme-sync\.js"/);
 assert.deepEqual(Array.from(drawer.matchAll(/data-settings-tab="([^"]+)"/g),m=>m[1]),['appearance','connections']);
 assert.match(drawer,/<h2>Settings<\/h2>/);
 assert.doesNotMatch(drawer,/id="drawerTheme"|id="followPc"|id="dim"|id="drawerLgHome"|id="drawerBack"|class="drawer-intro"|class="drawer-bottom"/);
 assert.doesNotMatch(drawer,/Everforest|PC theme bridge|Home behavior|source-derived candidates|Appearance, connections/);
 for(const id of ['shade','drawerNight','drawerArt','drawerGlass','drawerDetails','weatherPreview','connectPreview','editAppIds','weatherForm','jellyfinForm','appIdsForm'])assert.ok(drawer.includes('id="'+id+'"'),id);
 assert.match(drawer,/id="editAppIds">Advanced/);
 assert.match(drawer,/HTTP sends credentials unencrypted/);
 assert.doesNotMatch(html,/getElementById\('drawerBack'\)|getElementById\('drawerLgHome'\)|getElementById\('dim'\)|getElementById\('followPc'\)/);
 assert.match(html,/scrim\.querySelectorAll\('button,input,select'\)/);
});
test('shelf is presented as Moonfin and Jellyfin only identifies the server setup',()=>{
 const shelf=html.slice(html.indexOf('<section class="library-panel"'),html.indexOf('<footer class="footer"'));
 assert.match(shelf,/class="library-title">Moonfin<\/span>/);
 assert.doesNotMatch(shelf,/Jellyfin/);
 assert.match(shelf,/id="connect"[^>]*>Connect server<\/button>/);
 const drawer=html.slice(html.indexOf('<div class="scrim"'),html.indexOf('<div class="toast"'));
 assert.match(drawer,/<h3>Moonfin<\/h3>/);
 assert.match(drawer,/same Jellyfin server and account you use in Moonfin/);
 assert.match(drawer,/id="connectPreview">Connect server<\/button>/);
 assert.doesNotMatch(drawer,/<h3>Jellyfin<\/h3>|>Connect Jellyfin/);
 const runtime=fs.readFileSync(path.join(out,'runtime.js'),'utf8');
 assert.doesNotMatch(runtime,/Connect Jellyfin/);
});
