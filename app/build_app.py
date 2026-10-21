#!/usr/bin/env python3
"""Build the real TV shell without rewriting the approved design studies."""
from pathlib import Path
import json,re,shutil,subprocess,sys
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'dist'
SOURCE=ROOT.parent/'design-preview-glass.html'

def one(text,old,new):
    if text.count(old)!=1: raise ValueError('Expected one integration anchor: '+old[:100])
    return text.replace(old,new,1)

def clean_home_ui(text):
    """Remove redundant on-screen copy without removing art or navigation."""
    for pattern,count in [
        (r'<span class="theme-caption" id="themeCaption">.*?</span>',1),
        (r'<button class="top-button" id="lgHome"[^>]*>.*?</button>',1),
        (r'<span class="app-meta">.*?</span>',3),
        (r'<small id="shelfHint">.*?</small>',1),
        (r'<div class="footer-right">.*?</div>',1),
    ]:
        text,n=re.subn(pattern,'',text,flags=re.S)
        if n!=count:raise ValueError('Unexpected cleanup anchor count: '+pattern)
    text=one(text,'id="settings" data-row="-1" data-col="4" aria-label="Launcher settings"','id="settings" data-row="-1" data-col="4" aria-label="Settings"')
    text=one(text,"document.getElementById('shelfHint').textContent=shelfOpen?'Back to close':'One press away';",'')
    text=one(text,"document.getElementById('themeCaption').textContent=name;document.getElementById('drawerTheme').textContent=name;",'')
    text=text.replace('aria-label="Jellyfin shelf"','aria-label="Moonfin library"').replace('aria-label="Jellyfin shelves"','aria-label="Moonfin shelves"')
    text=one(text,'<span class="library-title">Your library</span>','<span class="library-title">Moonfin</span>')
    text=one(text,'id="connect" data-row="2" data-col="1">Connect Jellyfin &nbsp; →','id="connect" data-row="2" data-col="1">Connect server')
    text=one(text,'Continue your unfinished films and episodes.','No server linked.')
    text=one(text,'Connect Jellyfin to show your real viewing progress.','Use your Moonfin server and account.')
    return text

def clean_settings_ui(text):
    """Use a compact real settings surface, not prototype/tutorial chrome."""
    panel=(ROOT/'src'/'settings-panel.html').read_text().replace('{{CONNECTION_FORMS}}',(ROOT/'src'/'connection-forms.html').read_text())
    start=text.index('<div class="scrim" id="scrim"')
    end=text.index('<div class="toast"',start)
    text=text[:start]+panel+text[end:]
    for anchor in [
        "document.getElementById('dim').addEventListener('click',function(){setSettings(false);tv.classList.add('idle');});",
        "document.getElementById('drawerBack').addEventListener('click',function(){setSettings(false);});",
        "document.getElementById('drawerLgHome').addEventListener('click',function(){if(window.C2Runtime)window.C2Runtime.launch('lgHome');});",
        "document.getElementById('followPc').addEventListener('change',function(e){following=e.target.checked;if(following)refreshTheme(true);else syncLabel('PC follow paused',false);});",
    ]:
        text=one(text,anchor,'')
    # The LAN bridge is unconfigured on the TV; do not display disabled preview controls.
    start=text.index('function syncLabel(')
    end=text.index('updateClock();labelTheme(snapshot);',start)
    text=text[:start]+"function refreshTheme(){return Promise.resolve(false);}\n"+text[end:]
    text=one(text,"settingsTab=['appearance','connections','remote'].indexOf(name)>=0?name:'appearance';","settingsTab=['appearance','connections'].indexOf(name)>=0?name:'appearance';")
    text=one(text,"scrim.querySelectorAll('button,input')","scrim.querySelectorAll('button,input,select')")
    return text

def build():
    OUT.mkdir(exist_ok=True)
    text=SOURCE.read_text()
    # webOS ICU may produce 24:xx for local midnight with hour12=false.
    text=one(text,"now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})","('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2)")
    match=re.search(r'<img class="wallpaper" id="wallpaper" src="(data:image/[^"]+)"',text)
    if not match: raise ValueError('Missing embedded approved wallpaper')
    import base64
    uri=match.group(1);mime,b64=uri.split(',',1)
    ext='.png' if 'image/png' in mime else '.webp' if 'image/webp' in mime else '.jpg'
    wall='wallpaper'+ext
    (OUT/wall).write_bytes(base64.b64decode(b64,validate=True))
    text=one(text,uri,wall)
    wallpaper_tag=re.search(r'<img class="wallpaper" id="wallpaper"[^>]*>',text)
    if not wallpaper_tag: raise ValueError('Missing wallpaper image')
    text=text[:wallpaper_tag.end()]+'\n<img class="wallpaper wallpaper-next" id="wallpaperNext" alt="" hidden>'+text[wallpaper_tag.end():]
    text=one(text,'<title>C2 Home — smoked glass</title>','<title>C2 Home</title>')
    text=one(text,'</head>','<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\' https: http:; img-src \'self\' data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n<link rel="stylesheet" href="production.css">\n</head>')
    text=text.replace('aria-label="C2 artwork-first launcher prototype"','aria-label="C2 Home launcher"')
    # Boundary navigation and repeated pointer selection must not churn classes or save focus.
    text=one(text,"function select(el,focus){if(!el)return;", "function select(el,focus){if(!el)return;if(el===selected){if(focus)el.focus({preventScroll:true});return;}")
    # Keep the last dock target, including HDMI sources, across library trips/reloads.
    text=one(text,"if(el.classList.contains('app')){lastApp=el;save('focus',el.dataset.id);}","if(el.classList.contains('app')||el.classList.contains('source')){lastApp=el;save('focus',el.dataset.id||el.dataset.device);}")
    text=one(text,"var saved=load('focus','moonfin');select(document.querySelector('[data-id=\"'+(saved==='moonlight'||saved==='youtube'?saved:'moonfin')+'\"]'),false);","var saved=load('focus','moonfin');select(document.querySelector('[data-id=\"'+saved+'\"]')||document.querySelector('[data-device=\"'+saved+'\"]')||document.querySelector('[data-id=\"moonfin\"]'),false);")
    text=one(text,"return !n.closest('.library-panel')||shelfOpen;","return n.getClientRects().length>0&&(!n.closest('.library-panel')||shelfOpen);")
    text=one(text,"if(el.id==='settings'||el.id==='connect'){", "if(el.id==='connect'&&window.C2Runtime&&window.C2Runtime.getState().connected){window.C2Runtime.launch('moonfin');return;}if(el.id==='settings'||el.id==='connect'){")
    text=one(text,'<script>\n(function(){','<script src="settings.js"></script><script src="device.js"></script><script src="connections.js"></script><script src="theme-config.js"></script><script src="theme-sync.js"></script>\n<script>\n(function(){')
    text=one(text,"function fit(){tv.style.transform='scale('+frame.clientWidth/1920+')';}","function fit(){var s=Math.min(frame.clientWidth/1920,frame.clientHeight/1080);tv.style.transform=s===1?'':'scale('+s+')';tv.style.left=(frame.clientWidth-1920*s)/2+'px';tv.style.top=(frame.clientHeight-1080*s)/2+'px';}")
    text=one(text,"function save(k,v){try{localStorage.setItem('c2-gallery-'+k,v);}catch(e){}}\nfunction load(k,d){try{return localStorage.getItem('c2-gallery-'+k)||d;}catch(e){return d;}}", "var safeStore;try{safeStore=window.localStorage;}catch(e){}var prefs=window.C2Prefs=C2Settings.create(safeStore);\ndocument.addEventListener('visibilitychange',function(){if(document.hidden)prefs.flush();});window.addEventListener('pagehide',function(){prefs.flush();});\nfunction save(k,v){var p={};p[k]=k==='night'?v==='1':v;prefs.save(p);}\nfunction load(k,d){var v=prefs.load()[k];return typeof v==='boolean'?(v?'1':'0'):(v||d);}")
    text=one(text,"if(el.dataset.action)toast('Preview only — '+el.dataset.action+(el.classList.contains('source')?' would be selected.':' would open.'));", "if(el.dataset.action&&window.C2Runtime)window.C2Runtime.launchElement(el);")
    text=one(text,"document.getElementById('connectPreview').addEventListener('click',function(){toast('Preview only — Jellyfin sign-in is not configured.');});", "document.getElementById('connectPreview').addEventListener('click',function(){if(window.C2Runtime)window.C2Runtime.openJellyfin();});")
    text=one(text,"document.getElementById('weatherPreview').addEventListener('click',function(){toast('Preview only — weather needs your city and units.');});", "document.getElementById('weatherPreview').addEventListener('click',function(){if(window.C2Runtime)window.C2Runtime.openWeather();});")
    text=one(text,"document.getElementById('drawerLgHome').addEventListener('click',function(){toast('Preview only — LG Home would open.');});", "document.getElementById('drawerLgHome').addEventListener('click',function(){if(window.C2Runtime)window.C2Runtime.launch('lgHome');});")
    text=one(text,"updateClock();setInterval(updateClock,30000);labelTheme(snapshot);", "updateClock();labelTheme(snapshot);")
    text=one(text,"document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshTheme(false);});\nsetInterval(function(){refreshTheme(false);},5000);if(allowLive())refreshTheme(true);", "/* Production lifecycle is managed by runtime.js; no loopback preview polling. */")
    start=text.index("if(key.toLowerCase()==='h')")
    end=text.index("if(key==='Escape'",start)
    text=text[:start]+text[end:]
    start=text.index("document.addEventListener('keyup',function(e){")
    end=text.index("window.addEventListener('blur'",start)
    text=text[:start]+text[end:]
    text=one(text,"var key=e.key||'';if(wake())", "var key=e.key||({13:'Enter',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',27:'Escape'}[e.keyCode])||'';var editing=document.activeElement&&document.activeElement.matches('input:not([type=range]):not([type=checkbox]),textarea,select');if(editing&&key!=='Escape'&&e.keyCode!==461&&e.keyCode!==403)return;if(wake())")
    text=one(text,"if(wake()){e.preventDefault();return;}","if(wake()&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(key)<0){e.preventDefault();return;}")
    text=one(text,"if(key==='Escape'||e.keyCode===461){e.preventDefault();", "if(key==='Escape'||e.keyCode===461){if(e.keyCode===461&&!settingsOpen&&!shelfOpen)return;e.preventDefault();")
    text=one(text,"if(key==='Enter'&&(active.matches('button')||active.matches('input[type=checkbox]')))","if((key==='ArrowLeft'||key==='ArrowRight')&&active.matches('input[type=range]')){e.preventDefault();active.value=Math.max(Number(active.min),Math.min(Number(active.max),Number(active.value)+(key==='ArrowRight'?1:-1)));active.dispatchEvent(new Event('input',{bubbles:true}));return;}if(key==='Enter'&&(active.matches('button')||active.matches('input[type=checkbox]')))")
    api="window.C2UI={notify:toast,openSettings:function(tab){setSettingsTab(tab||'appearance',false);setSettings(true);},setArt:setArt,setNight:setNight,setClock:updateClock,select:function(id){select(document.querySelector('[data-id=\"'+id+'\"]')||document.querySelector('[data-device=\"'+id+'\"]'),false);},getState:function(){return window.c2Gallery.getState();}};\n"
    text=one(text,"window.c2Gallery={",api+"window.c2Gallery={")
    text=text.replace('Changes stay in this preview','Saved on this TV')
    text=text.replace('This preview does not configure the TV\'s idle behavior.','Launcher dimming does not replace the TV\'s native protections.')
    text=text.replace('Follow PC changes','PC theme bridge')
    text=text.replace('This file includes your current wallpaper and palette. Live following needs the local preview helper; no TV bridge is connected.','Your approved PC artwork is bundled for offline use. A LAN theme bridge is not configured yet.')
    text=text.replace('These are connection placeholders, not live sign-in flows. No account credentials, weather readings or viewing history are invented or stored.','Weather uses your chosen city. The server access token is saved in native TV preferences until you disconnect; your password is not saved.')
    text=text.replace('Return to the launcher</p><small>Short press · proposed','Home opens this launcher</p><small>System Home · no flash')
    text=text.replace('Open LG Home</p><small>Long press · needs physical-remote testing','Screen magnifier</p><small>Stock TV behavior')
    text=text.replace('Long press · needs physical-remote testing','Stock TV behavior')
    text=text.replace('The house icon opens LG Home independently of the proposed long-press gesture.','This launcher is installed as the TV\'s Home app. Home and app exit return here. Holding Home is handled by the TV (screen magnifier).')
    text=text.replace('Home · hold for LG Home (simulated)','Home · system Home')
    text=text.replace('<h3>Always an escape</h3>','<h3>Home behavior</h3>')
    text=text.replace('Open LG Home','Open Home')
    text=text.replace('for="appId-lgHome">LG Home','for="appId-lgHome">Home app')
    form=(ROOT/'src'/'connection-forms.html').read_text()
    text=one(text,'<p class="setting-note">Weather uses your chosen city.',form+'\n<p class="setting-note">Weather uses your chosen city.')
    material='<div class="action-grid material-actions"><button class="drawer-action" id="drawerGlass" aria-pressed="true">Frosted glass</button><button class="drawer-action" id="drawerDetails" aria-pressed="true">Card details</button></div>'
    text=one(text,'<section class="setting-group"><h3>When idle</h3>',material+'<section class="setting-group"><h3>When idle</h3>')
    text=one(text,'<div class="shelf-body">','<div class="shelf-body"><div class="shelf-items" id="shelfItems" hidden></div>')
    text=one(text,'</body>','<script src="runtime.js"></script>\n</body>')
    text=clean_settings_ui(clean_home_ui(text))
    (OUT/'index.html').write_text(text)
    for name in ['settings.js','device.js','connections.js','theme-sync.js','runtime.js','production.css','LiberationSerif-Regular.ttf','LiberationSerif-OFL.txt']:
        shutil.copyfile(ROOT/'src'/name,OUT/name)
    # Public builds must never discover and bundle private credentials implicitly.
    import os
    client_path=os.environ.get('C2_THEME_CONFIG')
    client=Path(client_path).expanduser() if client_path else None
    theme_config={'urls':[],'token':''}
    if client is not None:
        try:
            raw=json.loads(client.read_text())
            theme_config={'urls':[u for u in raw.get('urls',[]) if isinstance(u,str)][:4],'token':raw.get('token','') if isinstance(raw.get('token'),str) else ''}
        except (OSError,ValueError):
            pass
    (OUT/'theme-config.js').write_text('window.C2_THEME_CONFIG='+json.dumps(theme_config,separators=(',',':'))+';\n')
    # Flush coalesced focus before every native handoff, including library and Home actions.
    runtime=(OUT/'runtime.js').read_text()
    runtime=one(runtime,"launching=true;return device.launch(action,params)","launching=true;prefs.flush();return device.launch(action,params)")
    (OUT/'runtime.js').write_text(runtime)
    info={'id':'org.orca.c2home','version':'0.1.0','vendor':'Personal project','type':'web','main':'index.html','title':'C2 Home','icon':'icon.png','largeIcon':'large-icon.png','resolution':'1920x1080','disableBackHistoryAPI':True,'requiredACG':['application.launcher','application.query']}
    (OUT/'appinfo.json').write_text(json.dumps(info,indent=2)+'\n')
    for size,name in [(80,'icon.png'),(130,'large-icon.png')]:
        im=Image.new('RGBA',(size,size),'#173326');d=ImageDraw.Draw(im)
        d.rounded_rectangle((2,2,size-3,size-3),radius=size//5,outline='#a7c080',width=max(1,size//55))
        pts=[(size*.22,size*.47),(size*.5,size*.23),(size*.78,size*.47)]
        d.line(pts,fill='#dce8d2',width=max(2,size//24),joint='curve')
        d.line([(size*.3,size*.45),(size*.3,size*.75),(size*.7,size*.75),(size*.7,size*.45)],fill='#dce8d2',width=max(2,size//24))
        im.save(OUT/name)
    for p in OUT.glob('*.js'):subprocess.run(['node','--check',str(p)],check=True)
    scripts=re.findall(r'<script>(.*?)</script>',text,re.S)
    for s in scripts:subprocess.run(['node','--check'],input=s,text=True,check=True)
    print(json.dumps({'appId':info['id'],'version':info['version'],'output':str(OUT),'files':[p.name for p in sorted(OUT.iterdir())],'tvVerified':False},indent=2))
if __name__=='__main__':build()
