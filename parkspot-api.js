(function(){
  'use strict';

  const cfg = window.PARKSPOT_PAGES_CONFIG || {};
  const API_BASE = String(cfg.apiBaseUrl || '').replace(/\/$/,'');
  const TOKEN_KEY = 'parkspot_pages_gateway_token';
  const SERVICE_KEY = 'parkspot_pages_service_token';
  const EXPIRES_KEY = 'parkspot_pages_expires_at';

  let gatewayToken = sessionStorage.getItem(TOKEN_KEY) || '';
  let serviceToken = sessionStorage.getItem(SERVICE_KEY) || '';
  let expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
  let loginPromise = null;
  let loginResolve = null;
  let loginReject = null;

  window.PARKSPOT_SERVICE_TOKEN = serviceToken;

  function tokenValid(){
    return !!gatewayToken && (!expiresAt || Date.now() < expiresAt - 15000);
  }

  function clearSession(){
    gatewayToken='';serviceToken='';expiresAt=0;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SERVICE_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
    window.PARKSPOT_SERVICE_TOKEN='';
    if(typeof window.setParkSpotServiceToken==='function') window.setParkSpotServiceToken('');
  }

  function ensureOverlay(){
    let el=document.getElementById('pagesGatewayLogin');
    if(el) return el;
    const style=document.createElement('style');
    style.textContent=`
      #pagesGatewayLogin{position:fixed;inset:0;z-index:2147483000;background:rgba(9,18,31,.94);display:none;align-items:center;justify-content:center;padding:22px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #pagesGatewayLogin .pg-card{width:min(420px,100%);background:#fff;border-radius:22px;padding:24px;box-shadow:0 22px 70px rgba(0,0,0,.35)}
      #pagesGatewayLogin h2{margin:0 0 7px;font-size:24px;color:#142033}
      #pagesGatewayLogin p{margin:0 0 18px;color:#607087;line-height:1.45}
      #pagesGatewayLogin input{box-sizing:border-box;width:100%;font-size:18px;padding:13px 14px;border:1px solid #cfd8e3;border-radius:12px;outline:none}
      #pagesGatewayLogin input:focus{border-color:#446df6;box-shadow:0 0 0 3px rgba(68,109,246,.12)}
      #pagesGatewayLogin button{width:100%;margin-top:12px;border:0;border-radius:12px;padding:13px 16px;font-size:16px;font-weight:700;background:#2857d8;color:#fff;cursor:pointer}
      #pagesGatewayLogin button:disabled{opacity:.55;cursor:default}
      #pagesGatewayLogin .pg-error{min-height:20px;margin-top:10px;color:#b3261e;font-size:13px}
      #pagesGatewayLogin .pg-small{font-size:12px;color:#7a8798;margin-top:10px}
    `;
    document.head.appendChild(style);
    el=document.createElement('div');
    el.id='pagesGatewayLogin';
    el.innerHTML=`<div class="pg-card"><h2>ParkSpot</h2><p>Geschützter Zugriff. Bitte Service-PIN eingeben.</p><input id="pagesGatewayPin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN"><button id="pagesGatewayLoginBtn">Öffnen</button><div class="pg-error" id="pagesGatewayError"></div><div class="pg-small">Die PIN wird nur zur Anmeldung an den ParkSpot-Server gesendet und nicht auf GitHub Pages gespeichert.</div></div>`;
    document.body.appendChild(el);
    const input=el.querySelector('#pagesGatewayPin');
    const btn=el.querySelector('#pagesGatewayLoginBtn');
    btn.addEventListener('click',()=>submitLogin(input.value));
    input.addEventListener('keydown',ev=>{if(ev.key==='Enter')submitLogin(input.value);});
    return el;
  }

  function showLogin(){
    if(!API_BASE || /REPLACE-WITH/.test(API_BASE)){
      return Promise.reject(new Error('Cloud-Run-API-URL ist in config.js noch nicht eingerichtet.'));
    }
    if(loginPromise) return loginPromise;
    loginPromise=new Promise((resolve,reject)=>{loginResolve=resolve;loginReject=reject;});
    const el=ensureOverlay();
    el.style.display='flex';
    const input=el.querySelector('#pagesGatewayPin');
    const err=el.querySelector('#pagesGatewayError');
    if(err)err.textContent='';
    setTimeout(()=>input&&input.focus(),30);
    return loginPromise;
  }

  async function submitLogin(pin){
    const el=ensureOverlay(),btn=el.querySelector('#pagesGatewayLoginBtn'),err=el.querySelector('#pagesGatewayError'),input=el.querySelector('#pagesGatewayPin');
    pin=String(pin||'').trim();
    if(!pin){err.textContent='PIN eingeben.';return;}
    btn.disabled=true;err.textContent='';
    try{
      const resp=await fetch(API_BASE+'/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
      const data=await resp.json().catch(()=>({}));
      if(!resp.ok||!data.ok) throw new Error((data&&data.message)||'Anmeldung fehlgeschlagen.');
      gatewayToken=String(data.token||'');
      serviceToken=String(data.service_token||'');
      const ttl=Math.max(30,Number(data.expires_in_seconds||1800));
      expiresAt=Date.now()+ttl*1000;
      sessionStorage.setItem(TOKEN_KEY,gatewayToken);
      sessionStorage.setItem(SERVICE_KEY,serviceToken);
      sessionStorage.setItem(EXPIRES_KEY,String(expiresAt));
      window.PARKSPOT_SERVICE_TOKEN=serviceToken;
      if(typeof window.setParkSpotServiceToken==='function') window.setParkSpotServiceToken(serviceToken);
      input.value='';el.style.display='none';
      const resolve=loginResolve;loginPromise=null;loginResolve=null;loginReject=null;
      if(resolve)resolve(true);
    }catch(e){err.textContent=String(e&&e.message||e);}
    finally{btn.disabled=false;}
  }

  async function ensureAuth(){
    if(tokenValid()) return true;
    clearSession();
    return showLogin();
  }

  async function rpc(method,args,retry){
    await ensureAuth();
    const resp=await fetch(API_BASE+'/rpc',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+gatewayToken},
      body:JSON.stringify({method:String(method||''),args:Array.isArray(args)?args:[]})
    });
    const data=await resp.json().catch(()=>({}));
    if(resp.status===401 && retry!==false){
      clearSession();
      await showLogin();
      return rpc(method,args,false);
    }
    if(!resp.ok||!data.ok) throw new Error((data&&data.message)||(data&&data.error&&data.error.message)||('API HTTP '+resp.status));
    return data.result;
  }

  function makeRunner(success,failure){
    const target={
      withSuccessHandler(fn){return makeRunner(fn,failure);},
      withFailureHandler(fn){return makeRunner(success,fn);}
    };
    return new Proxy(target,{
      get(obj,prop){
        if(prop in obj)return obj[prop];
        if(typeof prop!=='string')return undefined;
        return function(){
          const args=Array.from(arguments);
          rpc(prop,args,true).then(res=>{if(typeof success==='function')success(res);}).catch(err=>{
            if(typeof failure==='function')failure({message:String(err&&err.message||err)});
            else console.error('ParkSpot RPC '+prop+' failed',err);
          });
        };
      }
    });
  }

  window.google=window.google||{};
  window.google.script=window.google.script||{};
  Object.defineProperty(window.google.script,'run',{configurable:true,get(){return makeRunner(null,null);}});

  window.ParkSpotPagesApi={
    login:showLogin,
    logout(){clearSession();return showLogin();},
    rpc,
    serviceToken(){return serviceToken;},
    isAuthenticated:tokenValid
  };
})();
