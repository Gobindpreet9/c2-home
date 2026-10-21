/* PC theme sync: one snapshot, then Server-Sent Events while Home is visible. */
(function(root){
'use strict';
var CACHE_KEY='c2-theme-cache-v1';
var STATUS={
  idle:'Checking PC…',
  connecting:'Checking PC…',
  live:'Following PC',
  unavailable:'PC unavailable · last artwork',
  disabled:'Not configured',
  paused:'PC sync paused'
};
function validColor(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);}
function mix(value,amount){
  if(!validColor(value))return null;
  var h=value.slice(1),target=[248,248,248],out=[];
  for(var i=0;i<3;i++){
    var c=parseInt(h.slice(i*2,i*2+2),16);
    out.push(Math.round(c*amount+target[i]*(1-amount)));
  }
  return 'rgb('+out.join(',')+')';
}
function rgb(hex){return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
function mixHex(a,b,amount){
  var x=rgb(a),y=rgb(b),out=[];
  for(var i=0;i<3;i++)out.push(Math.round(x[i]*(1-amount)+y[i]*amount));
  return '#'+out.map(function(n){return ('0'+n.toString(16)).slice(-2);}).join('');
}
function rgba(hex,alpha){var c=rgb(hex);return 'rgba('+c[0]+','+c[1]+','+c[2]+','+alpha+')';}
function mergeConfig(config){
  config=config||{};
  var urls=Array.isArray(config.urls)?config.urls.filter(function(u){return typeof u==='string'&&/^https?:\/\//i.test(u);}):[];
  return {urls:urls.map(function(u){return u.replace(/\/+$/,'');}),token:typeof config.token==='string'?config.token:''};
}
function endpoint(base,path,token){
  return base+path+(path.indexOf('?')<0?'?':'&')+'token='+encodeURIComponent(token);
}
function create(options){
  options=options||{};
  var win=options.window||root;
  var doc=options.document||win.document;
  var cfg=mergeConfig(options.config||win.C2_THEME_CONFIG);
  var fetchImpl=options.fetch||win.fetch;
  var EventSourceImpl=options.EventSource||win.EventSource;
  var timers=options.timers||{setTimeout:win.setTimeout.bind(win),clearTimeout:win.clearTimeout.bind(win)};
  var onApply=options.onApply||null;
  var onWallpaper=options.onWallpaper||null;
  var tv=doc&&doc.getElementById('tv');
  var wallpaper=doc&&doc.getElementById('wallpaper');
  var wallpaperNext=doc&&doc.getElementById('wallpaperNext');
  var statusEl=doc&&doc.getElementById('themeState');
  var refreshEl=doc&&doc.getElementById('themeRefresh');
  var status=cfg.token&&cfg.urls.length?'idle':'disabled';
  var theme=null,version=null,wallpaperVersion=null,currentBase=null;
  var visible=true,running=false,disposed=false,syncing=false;
  var es=null,retry=0,retryTimer=null,syncSeq=0,wallSeq=0,currentObject=null,wallController=null,wallpaperLoaded=false,wallpaperLoading=false,wallpaperLoadingVersion=null;
  var state={status:status,theme:null,version:null,wallpaperVersion:null,lastSync:0,error:null,streaming:false};

  function setStatus(next,error){
    status=next;state.status=next;state.error=error||null;
    if(statusEl)statusEl.textContent=STATUS[next]||next;
  }
  function setVar(name,value){if(tv&&value)tv.style.setProperty(name,value);}
  function applyPalette(data){
    if(!data)return;
    if(validColor(data.accent))setVar('--accent',data.accent.toLowerCase());
    var ink=mix(data.foreground,.03),muted=mix(data.foreground,.04);
    if(ink)setVar('--ink',ink);
    if(muted)setVar('--muted',muted);
    if(validColor(data.background))setVar('--theme-bg',data.background.toLowerCase());
    if(validColor(data.accent)){
      var a=data.accent.toLowerCase();
      var fillA=mixHex(a,'#ffffff',0.90),fillB=mixHex(a,'#ffffff',0.78);
      var border=mixHex(a,'#ffffff',0.62),selectedInk=mixHex(a,'#101010',0.76);
      setVar('--selected-fill-a',rgba(fillA,.92));
      setVar('--selected-fill-b',rgba(fillB,.78));
      setVar('--selected-border',rgba(border,.88));
      setVar('--selected-ink',selectedInk);
      setVar('--selected-icon-a',rgba(mixHex(a,'#ffffff',0.95),.9));
      setVar('--selected-icon-b',rgba(mixHex(a,'#ffffff',0.86),.45));
    }
    if(tv&&(data.mode==='light'||data.mode==='dark'))tv.dataset.themeMode=data.mode;
    if(wallpaper&&data.theme)wallpaper.alt='Current '+data.theme+' desktop wallpaper';
    if(onApply)onApply(data);
  }
  function readCache(){
    try{
      var raw=win.localStorage&&win.localStorage.getItem(CACHE_KEY);
      if(!raw)return null;
      var value=JSON.parse(raw);
      return value&&typeof value.version==='string'&&validColor(value.accent)?value:null;
    }catch(e){return null;}
  }
  function writeCache(data){
    try{
      if(!win.localStorage)return;
      win.localStorage.setItem(CACHE_KEY,JSON.stringify({theme:data.theme,accent:data.accent,foreground:data.foreground,background:data.background,mode:data.mode,version:data.version,wallpaperVersion:data.wallpaperVersion}));
    }catch(e){}
  }
  function apply(data){
    if(!data||typeof data.version!=='string')return false;
    var changed=data.version!==version;
    var imageChanged=data.wallpaperVersion&&data.wallpaperVersion!==wallpaperVersion;
    theme=typeof data.theme==='string'?data.theme:theme;
    version=data.version;
    state.theme=theme;state.version=version;state.lastSync=Date.now();
    if(changed){
      applyPalette(data);
      writeCache(data);
    }
    if(imageChanged||(!wallpaperLoaded&&!wallpaperLoading&&data.wallpaperVersion)){
      if(imageChanged)wallpaperLoaded=false;
      if(visible)loadWallpaper(data);
      wallpaperVersion=data.wallpaperVersion;
      state.wallpaperVersion=wallpaperVersion;
    }
    setStatus('live');
    return true;
  }
  function loadWallpaper(data){
    if(!currentBase||!data.wallpaper)return;
    if(wallpaperLoading&&wallpaperLoadingVersion===data.wallpaperVersion)return;
    var seq=++wallSeq;
    wallpaperLoading=true;wallpaperLoadingVersion=data.wallpaperVersion;
    if(wallController){try{wallController.abort();}catch(e){}}
    wallController=win.AbortController?new win.AbortController():null;
    var controller=wallController;
    var url=endpoint(currentBase,data.wallpaper,cfg.token);
    fetchImpl(url,{cache:'force-cache',credentials:'omit',signal:controller?controller.signal:undefined}).then(function(response){
      if(!response.ok)throw Error('wallpaper '+response.status);
      return response.blob();
    }).then(function(blob){
      if(seq!==wallSeq||!visible||disposed)return;
      var objectUrl=win.URL&&win.URL.createObjectURL?win.URL.createObjectURL(blob):null;
      if(!objectUrl)throw Error('object URL unavailable');
      if(onWallpaper){onWallpaper(objectUrl,data);currentObject=objectUrl;wallpaperLoaded=true;wallpaperLoading=false;return;}
      showWallpaper(objectUrl,seq);
    }).catch(function(error){
      if(seq===wallSeq){wallpaperLoading=false;if(!disposed)state.error=String(error&&error.message||error);}
    });
  }
  function showWallpaper(objectUrl,seq){
    if(!wallpaper){if(onWallpaper)onWallpaper(objectUrl,null);return;}
    if(!wallpaperNext){wallpaper.src=objectUrl;if(currentObject)win.URL.revokeObjectURL(currentObject);currentObject=objectUrl;wallpaperLoaded=true;wallpaperLoading=false;return;}
    wallpaperNext.onload=function(){
      if(seq!==wallSeq||!visible||disposed){win.URL.revokeObjectURL(objectUrl);return;}
      wallpaperNext.classList.add('show');
      var old=currentObject;
      timers.setTimeout(function(){
        if(seq!==wallSeq)return;
        wallpaper.src=objectUrl;
        currentObject=objectUrl;
        wallpaperLoaded=true;
        wallpaperNext.classList.remove('show');
        wallpaperLoading=false;
        timers.setTimeout(function(){wallpaperNext.hidden=true;wallpaperNext.removeAttribute('src');},520);
        if(old)win.URL.revokeObjectURL(old);
      },520);
    };
    wallpaperNext.onerror=function(){wallpaperNext.hidden=true;wallpaperLoading=false;win.URL.revokeObjectURL(objectUrl);};
    wallpaperNext.hidden=false;
    wallpaperNext.src=objectUrl;
  }
  function closeStream(){
    if(es){try{es.close();}catch(e){}es=null;}
    state.streaming=false;
    if(retryTimer){timers.clearTimeout(retryTimer);retryTimer=null;}
  }
  function scheduleRetry(error){
    if(!running||!visible||disposed)return;
    state.error=error?String(error):state.error;
    setStatus('unavailable',state.error);
    closeStream();
    retry++;
    var delay=Math.min(30000,1500*Math.pow(2,retry));
    retryTimer=timers.setTimeout(function(){retryTimer=null;if(running&&visible)sync(false);},delay);
  }
  function connect(base){
    closeStream();
    if(!EventSourceImpl){scheduleRetry('EventSource unavailable');return;}
    var source;
    try{source=new EventSourceImpl(endpoint(base,'/events',cfg.token));}catch(e){scheduleRetry(e);return;}
    es=source;
    source.onopen=function(){retry=0;state.streaming=true;setStatus('live');};
    source.addEventListener('theme',function(event){
      var data;
      try{data=JSON.parse(event.data);}catch(e){return;}
      apply(data);
    });
    source.onerror=function(){if(es===source)scheduleRetry('stream closed');};
  }
  function fetchTheme(base){
    return new Promise(function(resolve,reject){
      var controller=win.AbortController?new win.AbortController():null;
      var timer=timers.setTimeout(function(){
        if(controller)controller.abort();
        reject(Error('timeout'));
      },6000);
      fetchImpl(endpoint(base,'/api/theme',cfg.token),{cache:'no-store',credentials:'omit',signal:controller?controller.signal:undefined}).then(function(response){
        if(!response.ok)throw Error('theme '+response.status);
        return response.json();
      }).then(function(data){
        timers.clearTimeout(timer);resolve(data);
      }).catch(function(error){
        timers.clearTimeout(timer);reject(error);
      });
    });
  }
  function sync(manual){
    if(!running||!visible||disposed||status==='disabled')return Promise.resolve(false);
    if(syncing)return Promise.resolve(false);
    syncing=true;
    var seq=++syncSeq;
    setStatus('connecting');
    var urls=cfg.urls.slice(),index=0;
    function attempt(){
      if(!running||!visible||disposed||seq!==syncSeq){syncing=false;return false;}
      if(index>=urls.length){syncing=false;scheduleRetry('PC unreachable');return false;}
      var base=urls[index++];
      return fetchTheme(base).then(function(data){
        if(seq!==syncSeq)return false;
        currentBase=base;
        syncing=false;
        apply(data);
        connect(base);
        return true;
      },function(){return attempt();});
    }
    return attempt();
  }
  function stopNetwork(){
    syncSeq++;
    syncing=false;
    closeStream();
    if(wallController){try{wallController.abort();}catch(e){}wallController=null;}
    wallSeq++;wallpaperLoading=false;wallpaperLoadingVersion=null;
  }
  function setVisible(next){
    next=!!next;
    if(visible===next)return;
    visible=next;
    if(!visible){stopNetwork();setStatus('paused');}
    else if(running)sync(true);
  }
  function start(){if(disposed||running)return;running=true;if(visible&&status!=='disabled')sync(true);}
  function stop(){running=false;stopNetwork();setStatus(status==='disabled'?'disabled':'paused');}
  function dispose(){if(disposed)return;disposed=true;running=false;stopNetwork();if(currentObject&&win.URL)win.URL.revokeObjectURL(currentObject);currentObject=null;}
  if(refreshEl)refreshEl.addEventListener('click',function(){if(status!=='disabled'){retry=0;sync(true);}});
  var cached=readCache();
  if(cached){applyPalette(cached);theme=cached.theme;version=cached.version;wallpaperVersion=cached.wallpaperVersion;state.theme=theme;state.version=version;state.wallpaperVersion=wallpaperVersion;setStatus('idle');}
  if(status==='disabled')setStatus('disabled');else setStatus('idle');
  return {
    start:start,stop:stop,refresh:function(){retry=0;return sync(true);},
    setVisible:setVisible,getState:function(){return {status:state.status,theme:state.theme,version:state.version,wallpaperVersion:state.wallpaperVersion,lastSync:state.lastSync,error:state.error,streaming:state.streaming,visible:visible,running:running};},
    dispose:dispose
  };
}
root.C2ThemeSync={create:create,__test:{mergeConfig:mergeConfig,validColor:validColor,mix:mix,endpoint:endpoint}};
})(typeof window!=='undefined'?window:globalThis);
