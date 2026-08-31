/**
 * Task 30 — Z.ai Web browser bridge (bookmarklet connector)
 *
 * The ATS Pro web app (Cloudflare Pages) CANNOT read chat.z.ai storage:
 * Same-Origin Policy isolates it and session cookies are HttpOnly. Per the
 * Task 30 spec, instead of bypassing browser security we ship a USER-INITIATED
 * SAME-ORIGIN bridge:
 *
 *   1. User clicks "Open Z.ai" in the Z.ai Web card.
 *   2. User completes "Continue with Google" inside chat.z.ai (interactive,
 *      user-owned — no CAPTCHA/MFA/anti-bot mechanism is involved or evaded).
 *   3. While ON chat.z.ai, the user clicks the "Z.ai → ATS Pro" bookmarklet.
 *      The snippet below runs IN the chat.z.ai origin, executes the same
 *      discovery probes as ZaiWebSessionDiscovery (cookies / localStorage /
 *      sessionStorage — same-origin there), and transfers ONLY the Z.ai
 *      session state to the ATS Pro import endpoint (or to the clipboard as
 *      an offline fallback).
 *
 * The snippet is fully self-contained (bookmarklets cannot import modules)
 * and mirrors session-discovery.ts semantics. It never displays, logs, or
 * stores the token — it only forwards it over HTTPS to the import endpoint.
 */

import { ZAI_WEB_ORIGIN } from "./session-discovery";

export interface BridgeImportTarget {
  /** Absolute URL of /api/providers/zai-web/session-import. */
  importUrl: string;
}

export function buildZaiWebBookmarklet(target: BridgeImportTarget): string {
  const importUrl = target.importUrl.replace(/'/g, "%27");
  // eslint-disable-next-line no-useless-escape
  return `javascript:(function(){
  var KEYS=["token","access_token","auth_token","session_token","zai_token","satoken"];
  function unwrap(v){try{var p=JSON.parse(v);if(typeof p==="string")return p;if(p&&typeof p==="object"){var f=["token","value","accessToken","access_token"];for(var i=0;i<f.length;i++){if(typeof p[f[i]]==="string")return p[f[i]];}}}catch(e){}return v;}
  function ok(v){return v&&v.length>=16&&!/[\\s{}]/.test(v);}
  var found=null,source=null;
  for(var i=0;i<KEYS.length&&!found;i++){var m=document.cookie.match(new RegExp("(?:^|;\\\\s*)"+KEYS[i]+"=([^;]*)"));if(m){var c=decodeURIComponent(m[1]);if(ok(c)){found=c;source="cookie";}}}
  for(var i=0;i<KEYS.length&&!found;i++){var v=unwrap(localStorage.getItem(KEYS[i])||"");if(ok(v)){found=v;source="localStorage";}}
  for(var i=0;i<KEYS.length&&!found;i++){var v2=unwrap(sessionStorage.getItem(KEYS[i])||"");if(ok(v2)){found=v2;source="sessionStorage";}}
  if(!found){alert("No Z.ai web session found. Sign in to chat.z.ai first (Continue with Google), then run this bookmark again.");return;}
  var payload={provider_id:"zai-web",credential_type:"zai_web_session",token:found,source:source,origin:"${ZAI_WEB_ORIGIN}"};
  fetch('${importUrl}',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
    .then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{status:r.status,json:j};});})
    .then(function(res){
      if(res.status===200&&res.json&&res.json.ok){alert("Z.ai session imported to ATS Pro. Return to ATS Pro and run Test Connection / Sync Models.");}
      else if(res.status===501){alert("ATS Pro secure storage is unavailable (no D1 binding). Copying token to clipboard instead — paste it in the Z.ai Web card.");try{navigator.clipboard.writeText(found);}catch(e){}}
      else{alert("Import failed (HTTP "+res.status+"). "+((res.json&&res.json.message)||""));try{navigator.clipboard.writeText(found);}catch(e){}}
    })
    .catch(function(){alert("Could not reach ATS Pro. Token copied to clipboard instead — paste it in the Z.ai Web card.");try{navigator.clipboard.writeText(found);}catch(e){}});
})();`;
}
