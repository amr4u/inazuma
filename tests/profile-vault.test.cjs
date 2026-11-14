const test = require('node:test');
const assert = require('node:assert/strict');
const {MemoryProfileRepository} = require('../.test-dist/src/profile/repository.js');
const {ProfileVault} = require('../.test-dist/src/profile/vault.js');
const {ProfileService} = require('../.test-dist/src/profile/service.js');

test('vault encrypts complete document, unlocks and rejects wrong password',async()=>{
 const repository = new MemoryProfileRepository();
 const vault = new ProfileVault(repository); const service = new ProfileService(vault);
 await vault.create('long-password-abc-123',1500);
 await service.save({id:'p1',name:'密封資料',fields:[{key:'email',label:'Email',type:'text',value:'private@example.invalid'}]});
 await service.saveProvider('abc-account','very-private-token');
 assert.equal(JSON.stringify(repository.stored).includes('private@example.invalid'),false);
 assert.equal(JSON.stringify(repository.stored).includes('very-private-token'),false);
 assert.equal(service.getSchema('p1').fields[0].value,undefined);
 vault.lock();assert.equal(vault.isUnlocked(),false);
 await assert.rejects(()=>vault.unlock('wrong-password'));
 await vault.unlock('long-password-abc-123');
 assert.equal(service.get('p1').fields[0].value,'private@example.invalid');
 assert.equal(service.getProvider().token,'very-private-token');
});

test('profile selection and schema only include fields with values',async()=>{
 const vault=new ProfileVault(new MemoryProfileRepository());const service=new ProfileService(vault);
 await vault.create('some-password-that-is-long',1100);
 await service.save({id:'p1',name:'first',fields:[{key:'email',label:'Email',type:'text',value:'a@b.c'}, {key:'empty',label:'Empty',type:'text',value:''}]});
 await service.save({id:'p2',name:'second',fields:[{key:'email',label:'Email',type:'text',value:'b@c.d'}]});
 assert.deepEqual(service.getSchema('p1').fields.map(x=>x.key),['email']);
 await service.select('p2');
 assert.equal(service.getActiveProfile().name,'second');
});

test('encrypted backup imports on another repository and refuses wrong passwords',async()=>{
 const first=new ProfileVault(new MemoryProfileRepository());
 const data=new ProfileService(first);
 await first.create('the-first-passphrase-is-long',1200);
 await data.save({id:'local',name:'可攜帶資料',fields:[{key:'name',label:'姓名',type:'text',value:'tester'}]});
 const encrypted=await first.exportEncrypted();
 assert.equal(JSON.stringify(encrypted).includes('tester'),false);
 const secondRepository=new MemoryProfileRepository();
 const second=new ProfileVault(secondRepository);
 await assert.rejects(()=>second.importEncrypted(encrypted,'wrong-password'));
 assert.equal(await second.exists(),false);
 await second.importEncrypted(encrypted,'the-first-passphrase-is-long');
 assert.equal(new ProfileService(second).get('local').fields[0].value,'tester');
});
