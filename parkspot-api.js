(function(){
  'use strict';

  const cfg = window.PARKSPOT_PAGES_CONFIG || {};
  const API_BASE = String(cfg.apiBaseUrl || '').replace(/\/$/,'');
  const TOKEN_KEY = 'parkspot_pages_gateway_token';
  const EXPIRES_KEY = 'parkspot_pages_expires_at';

  let gatewayToken = sessionStorage.getItem(TOKEN_KEY) || '';
  let expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);

  // HF16: the normal dashboard is PIN-free. Remove any service/admin token
  // left by the older page-level login before the main Index script starts.
  sessionStorage.removeItem('parkspot_pages_service_token');
  window.PARKSPOT_SERVICE_TOKEN = '';

  function configured(){
    return !!API_BASE && !/REPLACE-WITH/.test(API_BASE);
  }

  function tokenValid(){
    return !!gatewayToken && (!expiresAt || Date.now() < expiresAt - 15000);
  }

  function clearGatewaySession(){
    gatewayToken='';
    expiresAt=0;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
  }

  async function ensureGatewaySession(){
    if(!configured()){
      throw new Error('Cloud-Run-API-URL ist in config.js noch nicht eingerichtet.');
    }
    if(tokenValid()) return true;

    clearGatewaySession();

    const resp=await fetch(API_BASE+'/session',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    });
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok||!data.ok||!data.token){
      throw new Error((data&&data.message)||'Gateway-Sitzung konnte nicht gestartet werden.');
    }

    gatewayToken=String(data.token||'');
    const ttl=Math.max(60,Number(data.expires_in_seconds||21600));
    expiresAt=Date.now()+ttl*1000;
    sessionStorage.setItem(TOKEN_KEY,gatewayToken);
    sessionStorage.setItem(EXPIRES_KEY,String(expiresAt));
    return true;
  }

  async function rpc(method,args,retry){
    await ensureGatewaySession();

    const resp=await fetch(API_BASE+'/rpc',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+gatewayToken
      },
      body:JSON.stringify({
        method:String(method||''),
        args:Array.isArray(args)?args:[]
      })
    });

    const data=await resp.json().catch(()=>({}));

    if(resp.status===401 && retry!==false){
      clearGatewaySession();
      await ensureGatewaySession();
      return rpc(method,args,false);
    }

    if(!resp.ok||!data.ok){
      throw new Error(
        (data&&data.message)||
        (data&&data.error&&data.error.message)||
        ('API HTTP '+resp.status)
      );
    }
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
          rpc(prop,args,true)
            .then(res=>{
              if(typeof success==='function')success(res);
            })
            .catch(err=>{
              if(typeof failure==='function'){
                failure({message:String(err&&err.message||err)});
              }else{
                console.error('ParkSpot RPC '+prop+' failed',err);
              }
            });
        };
      }
    });
  }

  window.google=window.google||{};
  window.google.script=window.google.script||{};
  Object.defineProperty(window.google.script,'run',{
    configurable:true,
    get(){return makeRunner(null,null);}
  });

  // Compatibility helper. No normal-page PIN prompt exists in HF16.
  // The existing Admin/Shield UI continues to call webAppUnlockService(pin)
  // and receives the short-lived Apps Script service token there.
  window.ParkSpotPagesApi={
    rpc,
    login:ensureGatewaySession,
    logout(){
      clearGatewaySession();
      return Promise.resolve(true);
    },
    isAuthenticated:tokenValid
  };
})();
