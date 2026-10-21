'use strict';
/* Local, one-purpose credential broker. Never logs/returns/writes passphrases or private keys. */
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
function createPairServer(controller,options={}){
 const token=options.token||crypto.randomBytes(24).toString('hex');let busy=false,attempts=0;
 const server=http.createServer(async(req,res)=>{
  const expected='127.0.0.1:'+server.address().port,origin='http://'+expected,base='/'+token;
  const headers={'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
  const send=(code,body,type='text/plain; charset=utf-8',extra={})=>{res.writeHead(code,{...headers,'Content-Type':type,...extra});res.end(body);};
  if(req.headers.host!==expected)return send(403,'Local host required.');
  if(![base,base+'/status',base+'/pair',base+'/install'].includes(req.url))return send(404,'Not found.');
  if(req.method==='GET'&&req.url===base+'/status')return send(200,JSON.stringify(controller.status()),'application/json');
  if(req.method==='GET'&&req.url===base){
   const paired=['paired','installed'].includes(controller.status().phase);
   const content=paired?'<p>Developer access verified. No root or Home/boot changes were performed.</p>':`<p>Enter the Developer Mode passphrase shown on your LG C2 using the masked credential prompt. This authorizes the existing developer account only, not root.</p><form method="post" action="${base}/pair"><label>TV developer account<input type="text" name="username" value="prisoner" autocomplete="username" readonly></label><label>Developer Mode passphrase<input type="password" name="passphrase" autocomplete="one-time-code" maxlength="256" required></label><input type="hidden" name="csrf" value="${token}"><button type="submit">Authorize developer access</button></form>`;
   return send(200,'<!doctype html><html><head><meta charset="utf-8"><title>LG C2 developer access</title><style>body{font:17px system-ui;background:#102018;color:#e6eddf;padding:40px;max-width:650px}label{display:block;margin:20px 0}input{display:block;padding:12px;font:inherit;width:90%;margin-top:8px}button{padding:14px;font:inherit}</style></head><body><h1>LG C2 developer access</h1>'+content+'<p>The passphrase stays out of chat, process arguments, logs and SDK configuration. The broker keeps it in memory only while authenticating.</p></body></html>','text/html; charset=utf-8');
  }
  if(req.method!=='POST'||![base+'/pair',base+'/install'].includes(req.url))return send(405,'Method not allowed.');
  if(req.headers.origin!==origin)return send(403,'Same-origin submission required.');
  if(!(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))return send(415,'Form data required.');
  if(Number(req.headers['content-length'])>4096){req.resume();return send(413,'Request too large.');}
  try{
   let size=0,chunks=[];for await(const b of req){size+=b.length;if(size>4096){chunks=[];return send(413,'Request too large.');}chunks.push(b);}
   const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
   if(form.get('csrf')!==token)return send(403,'Invalid request token.');
   if(busy)return send(409,'Another operation is in progress.');
   if(req.url===base+'/pair'){
    if(attempts>=3)return send(429,'Authorization attempts exhausted; stop and review.');
    const pass=form.get('passphrase');if(typeof pass!=='string'||!pass.length||pass.length>256)return send(400,'A passphrase is required.');
    attempts++;busy=true;try{await controller.pair(pass);return send(303,'Developer access verified.','text/plain; charset=utf-8',{Location:base});}catch(_){return send(401,'Developer authorization failed. Check the passphrase on the TV; no root or Home/boot changes were performed.');}finally{busy=false;}
   }
   if(!['paired','installed'].includes(controller.status().phase))return send(409,'Authorize developer access first.');
   busy=true;try{await controller.stage();return send(200,JSON.stringify(controller.status()),'application/json');}catch(_){return send(502,'Staging did not finish. Read the sanitized status before retrying; no root or Home/boot change was requested.');}finally{busy=false;}
  }catch(_){if(!res.headersSent)send(400,'Request could not be processed.');}
 });server.capabilityToken=token;server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
module.exports={createPairServer};
