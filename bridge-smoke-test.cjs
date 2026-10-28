const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const calls = [];
const origin = 'https://accounting.example';
const mockWindow = { location: { href: origin + '/app/index.html', origin } };
const context = {
  window: mockWindow, URL, URLSearchParams, Headers, Date, BigInt, Number, String, Object, Array, RegExp, Error,
  fetch: async (url, opts={}) => {
    calls.push({url,opts});
    const payload = url.endsWith('/health/live') ? {status:'ok'} : url.endsWith('/health/ready') ? {status:'ready'} : url.endsWith('/api/auth/login') ? {access_token:'test-token',expires_in:900,user:{id:'u1'}} : {id:'doc1',status:'POSTED'};
    return {ok:true,status:200,text:async()=>JSON.stringify(payload)};
  }
};
vm.runInNewContext(fs.readFileSync('aw-v10-bridge-v2.js','utf8'), context);
(async()=>{
  const bridge = mockWindow.AWV10Bridge;
  assert.ok(bridge);
  assert.throws(()=>bridge.configure({baseUrl:'https://evil.example'}), /V10_API_MUST_BE_SAME_ORIGIN/);
  bridge.configure({baseUrl:origin,companyId:'123e4567-e89b-42d3-a456-426614174000',deviceId:'test-device'});
  const h=await bridge.health(); assert.equal(h.live.status,'ok'); assert.equal(h.ready.status,'ready');
  await bridge.login('tester','not-saved'); assert.equal(bridge.status().authenticated,true);
  const doc={docType:'sale',docNo:'T-1',currency:'YER',exchangeRate:1,idempotencyKey:'123e4567-e89b-42d3-a456-426614174001',payload:{source:'test'},lines:[
    {accountId:'123e4567-e89b-42d3-a456-426614174002',currency:'YER',debit:10,credit:0,baseDebit:10,baseCredit:0},
    {accountId:'123e4567-e89b-42d3-a456-426614174003',currency:'YER',debit:0,credit:10,baseDebit:0,baseCredit:10}
  ]};
  assert.equal(bridge.validateDocumentPayload(doc),doc);
  assert.throws(()=>bridge.validateDocumentPayload({...doc,lines:[doc.lines[0],{...doc.lines[1],baseCredit:9}]}), /V10_BASE_CURRENCY_NOT_BALANCED/);
  const posted=await bridge.postDocument(doc); assert.equal(posted.status,'POSTED');
  assert.equal(calls.at(-1).opts.method,'POST');
  assert.equal(calls.at(-1).opts.headers.get('Authorization'),'Bearer test-token');
  bridge.logout(); assert.equal(bridge.status().authenticated,false);
  console.log('PASS bridge smoke: origin guard, health, memory-only login token, balanced payload validation, explicit post, logout');
})().catch(e=>{console.error(e);process.exit(1)});
