import{k as _}from"./index-CCZFPGYc.js";import{_ as b}from"./vendor-markdown-B46hRaTo.js";import"./vendor-react-Eg9wN1l5.js";import"./vendor-state-Cm_XB1xy.js";import"./vendor-tauri-DP7f-jEB.js";const M=1e5,v=3e4,x={eval:void 0,Function:void 0,setTimeout:void 0,setInterval:void 0,clearTimeout:void 0,clearInterval:void 0,requestAnimationFrame:void 0,cancelAnimationFrame:void 0,queueMicrotask:void 0,__import__:void 0,importScripts:void 0};function T(){return{chunks:[],size:0,truncated:!1}}function A(t,e){t.truncated||(t.chunks.push(e),t.size+=e.length,t.size>M&&(t.chunks.push(`
... (output truncated)
`),t.truncated=!0))}function E(t){if(t===null)return"null";if(t===void 0)return"undefined";if(typeof t=="object")try{return JSON.stringify(t,null,2)}catch{return String(t)}return String(t)}function D(t){const e={};for(const s of["log","info","warn","error","debug","trace"])e[s]=(...r)=>{A(t,r.map(E).join(" ")+`
`)};return e}function R(t,e,s){const r={console:D(t),Array,Object,String,Number,Boolean,Math,JSON,Map,Set,WeakMap,WeakSet,Promise,RegExp,Date,Error,Symbol,BigInt,TypeError,RangeError,ReferenceError,SyntaxError,URIError,parseInt,parseFloat,isNaN,isFinite,Infinity:1/0,NaN:NaN,undefined:void 0,null:null,encodeURI,encodeURIComponent,decodeURI,decodeURIComponent,ArrayBuffer,Uint8Array,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigUint64Array,BigInt64Array,DataView,Intl,structuredClone,...x,...e};return s&&typeof fetch<"u"&&(r.fetch=fetch),{names:Object.keys(r),values:Object.values(r)}}async function I(t,e,s){const r=s?.timeoutMs??v,o=s?.allowNetwork??!1,n=performance.now(),a=T(),{names:m,values:u}=R(a,e??{},o);let c,i=null,l;const f=new Promise(p=>{try{c=new Function(...m,`"use strict";
${t}`)(...u)}catch(h){i=h instanceof Error?h:new Error(String(h))}finally{p()}}),d=new Promise((p,h)=>{l=setTimeout(()=>{h(new Error(`Sandbox execution timed out after ${r} ms`))},r)});try{await Promise.race([f,d])}catch(p){i=p instanceof Error?p:new Error(String(p))}finally{l!==void 0&&(clearTimeout(l),l=void 0)}const g=Math.round(performance.now()-n),y=a.chunks.join("");return{success:i===null,output:y,error:i?.message??i?.toString(),result:c,durationMs:g,truncated:a.truncated}}const L=1e3,U=[/^\s*create\s/i,/^\s*drop\s/i,/^\s*alter\s/i,/^\s*truncate\s/i,/^\s*vacuum\s/i,/^\s*reindex\s/i,/^\s*attach\s/i],F=[/^\s*select\s/i,/^\s*pragma\s/i,/^\s*explain\s/i];function O(t){const e=t.trim();return U.some(s=>s.test(e))}function S(t){const e=t.trim();return F.some(s=>s.test(e))}async function $(t,e){const s=await _();try{return S(t)?{result:(await s.query(t)).slice(0,e)}:(await s.execute(t),{result:{affected:!0}})}catch(r){return{error:r instanceof Error?r.message:String(r)}}}function N(t){const e=[];let s="",r=!1,o=!1,n=!1,a="";for(let u=0;u<t.length;u++){const c=t[u],i=t[u+1]??"";if(!r&&!o){if(c==="-"&&i==="-"&&!n){n=!0;continue}if(c===`
`&&n){n=!1;continue}}if(!n){if(c==="'"&&!o?r&&a==="'"||(r=!r):c==='"'&&!r&&(o=!o),c===";"&&!r&&!o){const l=s.trim();l&&e.push(l),s="",a=c;continue}s+=c,a=c}}const m=s.trim();return m&&e.push(m),e}async function j(t,e){const s=e?.allowDDL??!1,r=e?.maxRows??L,o=performance.now(),n=N(t);if(n.length===0)return{success:!0,output:"",durationMs:0,truncated:!1};if(!s){for(const i of n)if(O(i)){const l=Math.round(performance.now()-o);return{success:!1,output:"",error:`DDL statements are blocked. Set allowDDL: true to permit: ${i.slice(0,80)}`,durationMs:l,truncated:!1}}}const a=[];let m,u;for(let i=0;i<n.length;i++){const l=n[i];try{const{result:f,error:d}=await $(l,r);if(d){u??=d,a.push(`-- Statement ${i+1} error: ${d}`);break}if(f!==void 0)if(m=f,S(l)){const y=f.length,p=y>=r?` (limited to ${r})`:"";a.push(`-- ${y} row(s) returned${p}`)}else a.push("-- OK")}catch(f){const d=f instanceof Error?f.message:String(f);u??=d,a.push(`-- Statement ${i+1} error: ${d}`);break}}const c=Math.round(performance.now()-o);return{success:u===void 0,output:a.join(`
`),error:u,result:m,durationMs:c,truncated:!1}}async function k(t){const{invoke:e}=await b(async()=>{const{invoke:r}=await import("./vendor-tauri-DP7f-jEB.js").then(o=>o.c);return{invoke:r}},[]);return await e("exec_python",{code:t.code,timeoutSec:t.timeoutSec??30,params:t.params??{},allowAllImports:t.allowAllImports??!1})}const P=3e4;async function B(t,e,s){const r=s?.timeoutMs??P,o=performance.now();try{const n=await k({code:t,timeoutSec:Math.ceil(r/1e3),params:e,allowAllImports:s?.allowAllImports??!1});return{success:n.success,output:n.output,error:n.error,result:n.result,durationMs:n.durationMs,truncated:n.truncated}}catch(n){const a=Math.round(performance.now()-o);return{success:!1,output:"",error:n instanceof Error?n.message:String(n),durationMs:a,truncated:!1}}}const w=1e6,C=[/\bon\w+\s*=\s*["'][^"']*["']/gi,/\bon\w+\s*=\s*\w+/gi,/href\s*=\s*["']javascript:[^"']*["']/gi,/src\s*=\s*["']javascript:[^"']*["']/gi,/src\s*=\s*["']data:text\/html[^"']*["']/gi];function H(t){const e={head:"",body:"",styles:[],scripts:[],hasDoctype:!1,hasHtmlTag:!1};e.hasDoctype=/<!DOCTYPE\s+html/i.test(t),e.hasHtmlTag=/<html[\s>]/i.test(t);const s=/<style[^>]*>([\s\S]*?)<\/style>/gi;let r;for(;(r=s.exec(t))!==null;)e.styles.push(r[1]);const o=/<script[^>]*>([\s\S]*?)<\/script>/gi;for(;(r=o.exec(t))!==null;)/<script[^>]+src=/i.test(r[0])||e.scripts.push(r[1]);const n=t.match(/<head[^>]*>([\s\S]*?)<\/head>/i);n&&(e.head=n[1]);const a=t.match(/<body[^>]*>([\s\S]*?)<\/body>/i);return a?e.body=a[1].replace(o,"").trim():e.hasHtmlTag||(e.body=t.replace(s,"").replace(o,"").trim()),e}function z(t){let e=t;for(const s of C)e=e.replace(s,"");return e}function G(t){return`
(function() {
  const __logs = [];
  const __console = {
    log: function() { __logs.push(Array.from(arguments).map(String).join(' ')); },
    info: function() { __logs.push('[INFO] ' + Array.from(arguments).map(String).join(' ')); },
    warn: function() { __logs.push('[WARN] ' + Array.from(arguments).map(String).join(' ')); },
    error: function() { __logs.push('[ERROR] ' + Array.from(arguments).map(String).join(' ')); },
    debug: function() { __logs.push('[DEBUG] ' + Array.from(arguments).map(String).join(' ')); },
    clear: function() { __logs.length = 0; },
    table: function(data) { __logs.push(JSON.stringify(data, null, 2)); },
  };

  // Override console in this scope
  const console = __console;

  // Capture errors
  window.__sandboxErrors = [];

  try {
    ${t}
  } catch (err) {
    window.__sandboxErrors.push(err.message || String(err));
    __console.error(err.message || String(err));
  }

  // Expose logs for parent to read
  window.__sandboxLogs = __logs;
})();`}function J(t){const{parsed:e,allowExternalResources:s,baseUrl:r}=t,o=z(e.body),n=["default-src 'self' 'unsafe-inline' 'unsafe-eval'",s?"img-src * data: blob:":"img-src 'self' data: blob:",s?"font-src * data:":"font-src 'self' data:",s?"style-src 'self' 'unsafe-inline' *":"style-src 'self' 'unsafe-inline'","script-src 'self' 'unsafe-inline' 'unsafe-eval'","frame-src 'none'","object-src 'none'","base-uri 'self'"].join("; "),a=r?`<base href="${r}">`:"",m=e.styles.join(`
`),u=e.scripts.map(G).join(`
`);return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${n}">
  ${a}
  <style>
    /* Reset and base styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      padding: 16px;
    }
    ${m}
  </style>
  ${e.head}
</head>
<body>
  ${o}
  <script>
    ${u}
  <\/script>
</body>
</html>`}async function Q(t,e){const s=performance.now();if(t.length>w)return{success:!1,output:"",error:`HTML code exceeds maximum size of ${w} bytes`,durationMs:Math.round(performance.now()-s),truncated:!0};try{const r=H(t),o=J({parsed:r,allowExternalResources:e?.allowExternalResources??!1,baseUrl:e?.baseUrl}),n=Math.round(performance.now()-s);return{success:!0,output:"HTML document generated successfully",result:{hasStyles:r.styles.length>0,hasScripts:r.scripts.length>0,isFullDocument:r.hasHtmlTag},durationMs:n,truncated:!1,htmlContent:t,isolatedDocument:o}}catch(r){const o=Math.round(performance.now()-s);return{success:!1,output:"",error:`HTML processing failed: ${r instanceof Error?r.message:String(r)}`,durationMs:o,truncated:!1}}}const W={timeoutMs:3e4,allowNetwork:!1,allowDDL:!1,maxRows:1e3};class X{constructor(){this._pythonFullAccess=!1}setPythonFullAccess(e){this._pythonFullAccess=e}async execute(e,s,r,o){const n={...W,...o};switch(e==="python"&&this._pythonFullAccess&&(n.allowAllImports=!0),e){case"javascript":return I(s,r,n);case"python":return B(s,r,n);case"sql":return j(s,n);case"html":return this._executeHTML(s,n);default:return{success:!1,output:"",error:`Unsupported language: ${e}`,durationMs:0,truncated:!1}}}async _executeHTML(e,s){return Q(e,s)}}const tt=new X;export{X as CodeSandboxService,tt as codeSandboxService};
