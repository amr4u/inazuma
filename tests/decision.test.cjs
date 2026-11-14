const test=require('node:test');const assert=require('node:assert/strict');
const {CloudflareClefOmniProvider}=require('../.test-dist/src/providers/clef-omni.js');
const {DecisionEngine}=require('../.test-dist/src/decision/provider.js');
const {resolveActions}=require('../.test-dist/src/decision/resolve.js');

const field=(id,filled=false)=>({id,kind:'text',inputType:'text',label:'メールアドレス',name:'email',placeholder:'',autocomplete:'email',context:'連絡先',filled,required:false});
const schema={id:'main',name:'Individual',fields:[{key:'email',label:'Email',type:'text'}]};

test('Cloudflare adapter batches decisions, maps keys and never sends profile values',async()=>{
 const calls=[];
 const mockFetch=async(url,init)=>{
   const body=JSON.parse(init.body);calls.push({url,body});
   const answers=Object.fromEntries(Object.keys(body.questions).map(key=>[key,{type:'choice',choice:'p0',confidence:.94}]));
   return new Response(JSON.stringify({success:true,result:{answers}}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const snapshot={url:'https://example.com/signup?token=SENSITIVE',title:'Form',fields:Array.from({length:65},(_,i)=>field(`f${i}`))};
 const provider=new CloudflareClefOmniProvider('account-123','secret-token',mockFetch);
 const plan=await new DecisionEngine(provider).decide(snapshot,schema);
 assert.equal(plan.fields.length,65);assert.equal(calls.length,2);
 assert.equal(Object.keys(calls[0].body.questions).length,64);
 assert.ok(calls[0].url.includes('@cf/cloudflare/clef-omni'));
 assert.ok(!JSON.stringify(calls).includes('SENSITIVE'));
 assert.ok(!JSON.stringify(calls).includes('alice@example.com'));
 assert.equal(plan.fields[0].profileKey,'email');
});

test('resolveActions respects existing field values',()=>{
 const snap={url:'https://example.com',title:'x',fields:[field('f1',true),field('f2')]};
 const plan={providerId:'mock',fields:[{fieldId:'f1',profileKey:'email'},{fieldId:'f2',profileKey:'email'}]};
 const profile={id:'p1',name:'test',fields:[{key:'email',type:'text',label:'Email',value:'alice@example.com'}]};
 assert.deepEqual(resolveActions(snap,plan,profile).actions,[{fieldId:'f2',value:'alice@example.com'}]);
 assert.equal(resolveActions(snap,plan,profile,true).actions.length,2);
});

test('DecisionEngine discards unknown and duplicate provider decisions',async()=>{
 const snap={url:'x',title:'x',fields:[field('f1')]};
 const provider={id:'mock',decide:async()=>({providerId:'mock',fields:[
   {fieldId:'f1',profileKey:'email'}, {fieldId:'f1',profileKey:'email'},
   {fieldId:'f999',profileKey:'email'}, {fieldId:'f1',profileKey:'unknown'},
 ]})};
 const result=await new DecisionEngine(provider).decide(snap,schema);
 assert.equal(result.fields.length,1);
});
