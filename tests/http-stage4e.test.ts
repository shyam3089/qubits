import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {firefox} from 'playwright';
import {compile} from '../language/index.js';
import {createHttp} from '../runtime/http.js';

const serviceSource=`class Item:
    id = 0
    name = ""
service Catalog:
    client api
    query item:
        get "/item"
        response Item
        cache 60s
    action rename(name):
        patch "/item"
        body name
        response Item
        refresh item
        instant item:
            name = name`;

test('Stage 4E preserves all thirteen approved HTTP and connection syntax surfaces together',()=>{
  const service=compile(serviceSource,'Catalog.qb'),component=compile(`import Catalog from "./Catalog.qb"
class Receipt:
    size = 0
component Complete:
    state photo = null
    http client api:
        base "https://api.example.test/v1/"
        auth bearer token
        interceptor trace
    client api
    use Catalog
    query dependent:
        get Catalog.item.data.name
        response string
        cache 30s
    action upload(file):
        post "upload"
        upload "photo" = file
        response Receipt
    action report():
        get "report"
        download "report.bin"
    socket alerts:
        connect "alerts"
        on message(data):
            Catalog.rename(data)
        on disconnect:
            reconnect 1s
    sse news:
        connect "news"
        on message(data):
            Catalog.rename(data)
        on disconnect:
            reconnect 1s
    input type="file" bind=photo
    button text="Upload":
        on click:
            upload(photo)
    button text="Read":
        on click:
            result = await http.get("health") client api response string
    p text=Catalog.item.data.name + dependent.data`, 'Complete.qb',{services:new Map([['Catalog',service.ast]])});
  assert.equal(component.ast.uses.length,1);assert.equal(component.ast.queries.length,1);assert.equal(component.ast.httpActions.length,2);assert.equal(component.ast.sockets.length,1);assert.equal(component.ast.sse.length,1);assert.match(component.code,/"services"/);
});

test('Stage 4E HTTP security bounds redirects, origins, tokens, malformed payloads, concurrency and cancellation',async()=>{
  const calls:{url:string;init:RequestInit}[]=[],resolvers:((response:Response)=>void)[]=[];
  const api=createHttp({maxResponseItems:2,clients:{api:{base:'https://api.test/v1/',auth:()=> 'secret-token'}},fetch:async(input,init)=>{calls.push({url:String(input),init:init!});return await new Promise<Response>(resolve=>resolvers.push(resolve));}});
  const first=api.get('one',{client:'api',response:'number'}),second=api.get('two',{client:'api',response:'number'});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,2);resolvers[1](new Response('2',{headers:{'content-type':'application/json'}}));resolvers[0](new Response('1',{headers:{'content-type':'application/json'}}));assert.deepEqual(await Promise.all([first,second]),[1,2]);
  for(const call of calls){assert.equal(new URL(call.url).search.includes('secret-token'),false);assert.equal((call.init.headers as Headers).get('authorization'),'Bearer secret-token');assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'same-origin');}
  await assert.rejects(()=>api.get('https://evil.test/x',{client:'api'}),/cannot escape/);
  await assert.rejects(()=>createHttp({clients:{api:{base:'https://api.test/',auth:()=> 'token',request:[request=>({...request,url:'https://evil.test/x'})]}},fetch:async()=>new Response('{}')}).get('/x',{client:'api'}),/cannot escape the configured base origin/);
  await assert.rejects(()=>createHttp({maxResponseItems:2,fetch:async()=>new Response('[1,2,3]',{headers:{'content-type':'application/json'}})}).get('/x',{response:{list:'number'}}),/maximum of 2 items/);
  await assert.rejects(()=>createHttp({fetch:async()=>new Response('{"id":1,"__proto__":{"polluted":true}}',{headers:{'content-type':'application/json'}})}).get('/x',{response:{fields:{id:'number'}}}),/Unknown field __proto__/);
  await assert.rejects(()=>createHttp({fetch:async()=>new Response('{"id":"bad"}',{headers:{'content-type':'application/json'}})}).get('/x',{response:{fields:{id:'number'}}}),/requires number/);assert.equal(({} as {polluted?:boolean}).polluted,undefined);
  let cancelled=false;const controller=new AbortController(),pending=createHttp({fetch:async(_input,init)=>await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{cancelled=true;reject(init.signal!.reason);},{once:true}))}).get('/slow',{signal:controller.signal});controller.abort(new DOMException('cancelled','AbortError'));await assert.rejects(()=>pending,(error:unknown)=>(error as Error).name==='AbortError');assert.equal(cancelled,true);
});

test('Stage 4E rejects conflicting inherited service clients and rolls back the failed Firefox mount',async()=>{
  const service=compile(serviceSource,'Catalog.qb'),services=new Map([['Catalog',service.ast]]),consumer=(name:string,base:string)=>compile(`import Catalog from "./Catalog.qb"
component ${name}:
    http client api:
        base "${base}"
    use Catalog
    if Catalog.item.success:
        p text=Catalog.item.data.name
    else:
        p text="loading"`,`${name}.qb`,{services}),first=consumer('First','https://first.test/'),second=consumer('Second','https://second.test/'),root=compile(`import First from "./First.qb"
import Second from "./Second.qb"
component App:
    First
    Second`,'App.qb',{components:new Map([['First',first.ast],['Second',second.ast]])}),runtime=await readFile('dist/lib/runtime/index.js','utf8');
  const browser=await firefox.launch({headless:true});try{const page=await browser.newPage();await page.addScriptTag({content:'globalThis.__name=(value)=>value;'});const result=await page.evaluate(async({runtime,serviceCode,firstCode,secondCode,rootCode})=>{const urls:string[]=[],url=(source:string)=>{const value=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.push(value);return value;},runtimeUrl=url(runtime),serviceUrl=url(serviceCode),firstUrl=url(firstCode.replace('"./Catalog.qb"',JSON.stringify(serviceUrl))),secondUrl=url(secondCode.replace('"./Catalog.qb"',JSON.stringify(serviceUrl))),rootUrl=url(rootCode.replace('"./First.qb"',JSON.stringify(firstUrl)).replace('"./Second.qb"',JSON.stringify(secondUrl)));try{(globalThis as any).fetch=(_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal!.reason),{once:true}));const api=await import(runtimeUrl),view=await import(rootUrl),host=document.createElement('main');let failure='';try{view.default(host,api);}catch(error){failure=(error as Error).message;}await new Promise(resolve=>setTimeout(resolve,0));return {failure,nodes:host.childNodes.length,text:host.textContent};}finally{urls.forEach(URL.revokeObjectURL);}},{runtime,serviceCode:service.code,firstCode:first.code,secondCode:second.code,rootCode:root.code});assert.deepEqual(result,{failure:'Service Catalog requires one HTTP client context per application',nodes:0,text:''});}finally{await browser.close();}
});
