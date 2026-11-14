const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root=path.resolve(__dirname,'..');

test('built Firefox background handles encrypted setup, provider call and fill',async()=>{
  const store={}; let listener; let apply;
  const snapshot={url:'https://example.org/signup?secret=unused',title:'Register',fields:[
    {id:'f1',kind:'text',inputType:'email',label:'メールアドレス',name:'email',placeholder:'',autocomplete:'email',context:'連絡先',filled:false,required:true},
    {id:'f2',kind:'text',inputType:'password',label:'パスワード',name:'pass',placeholder:'',autocomplete:'new-password',context:'Login',filled:false,required:true},
  ]};
  const browser={
    runtime:{getURL:()=> 'moz-extension://test/',onMessage:{addListener(f){listener=f}}},
    storage:{local:{get:async(key)=>({[key]:store[key]}),set:async(values)=>{Object.assign(store,values)}}},
    tabs:{query:async()=>[{id:42,url:'https://example.org/signup'}],sendMessage:async(_,message)=>{
      if(message.type==='capture')return snapshot;
      if(message.type==='apply'){apply=message.actions;return {applied:apply.length,skipped:0,details:[]}};
    }},
  };
  const calls=[];
  const fetch=async(_,init)=>{
    const body=JSON.parse(init.body);calls.push(body);
    return new Response(JSON.stringify({success:true,result:{answers:{
      f0:{type:'choice',choice:'p0',confidence:.98},
      f1:{type:'choice',choice:'p1',confidence:.98},
    }}}),{status:200});
  };
  const code=fs.readFileSync(path.join(root,'dist-firefox-offline/background.js'),'utf8');
  vm.runInNewContext(code,{browser,fetch,Response,crypto:globalThis.crypto,TextEncoder,TextDecoder,btoa,atob,
      Uint8Array,structuredClone,Date,URL,console,JSON});
  const send=async(request)=>{
    const result=await listener(request,{url:'moz-extension://test/popup/index.html'});
    if(!result.ok)throw Error(result.error);
    return result.data;
  };
  assert.equal((await send({type:'status'})).exists,false);
  await send({type:'createVault',password:'my-password-very-long'});
  await send({type:'saveProfile',profile:{id:'abc',name:'Personal',fields:[
    {key:'email',label:'電子郵件',description:'メールアドレス',type:'text',value:'me@example.net'},
    {key:'pass',label:'密碼',description:'パスワード',type:'secret',value:'not-a-real-password'},
  ]}});
  await send({type:'saveProvider',accountId:'my-account',token:'my-token'});
  const result=await send({type:'fill'});
  assert.equal(result.report.applied,2);
  assert.deepEqual(JSON.parse(JSON.stringify(apply)),[
    {fieldId:'f1',value:'me@example.net'},
    {fieldId:'f2',value:'not-a-real-password'},
  ]);
  assert.ok(!JSON.stringify(calls).includes('me@example.net'));
  assert.ok(!JSON.stringify(calls).includes('not-a-real-password'));
  assert.ok(!JSON.stringify(store).includes('my-token'));
  await send({type:'lock'});
  assert.equal((await send({type:'status'})).unlocked,false);
});
