import { rpc } from '../../src/app/rpc';
import type { Profile, ProfileField, ProfileFieldType, ProfileSummary } from '../../src/common/types';

const el = <T extends HTMLElement>(id:string):T => document.getElementById(id) as T;
const notice = (text:string,error=false):void => {el('message').textContent=text;el('message').className=`status ${error?'error':''}`;};
let draft:Profile;
const starterFields: ProfileField[] = [
  ['family_name','姓','姓氏／氏／Last name','text'],
  ['given_name','名','名字／名前／First name','text'],
  ['family_name_kana','姓（フリガナ）','片假名姓氏／セイ','text'],
  ['given_name_kana','名（フリガナ）','片假名名字／メイ','text'],
  ['email','電子郵件','メールアドレス／E-mail','text'],
  ['phone','電話','電話番号／携帯番号','text'],
  ['postal_code','郵遞區號','郵便番号／〒','text'],
  ['prefecture','都道府縣','都道府県／県','text'],
  ['address','地址','住所／市区町村／番地','text'],
  ['building','建物名稱','建物名／部屋番号','text'],
  ['password','密碼','パスワード／密碼確認欄位也使用這個值','secret'],
].map(([key,label,description,type])=>({key,label,description,type:type as ProfileFieldType,value:''}));
draft=emptyProfile();

function emptyProfile():Profile {return {id:crypto.randomUUID(),name:'個人',fields:structuredClone(starterFields)};}
// The function declaration above is called before starterFields is initialized only if invoked here.
function readFields():ProfileField[] {
  return Array.from(el('field-list').querySelectorAll<HTMLElement>('.field-row')).map(row=>({
    key:row.querySelector<HTMLInputElement>('[data-field="key"]')!.value.trim(),
    label:row.querySelector<HTMLInputElement>('[data-field="label"]')!.value.trim(),
    description:row.querySelector<HTMLInputElement>('[data-field="description"]')!.value.trim(),
    type:row.querySelector<HTMLSelectElement>('[data-field="type"]')!.value as ProfileFieldType,
    value:row.querySelector<HTMLInputElement>('[data-field="value"]')!.value,
  })).filter(f => f.key || f.label || f.value);
}
function addField(field:ProfileField):void {
  const row = document.createElement('div'); row.className='field-row';
  const grid = document.createElement('div'); grid.className='field-grid';
  const textInput = (key:keyof ProfileField, title:string, text:string, type='text'):void => {
    const label = document.createElement('label'); label.textContent=title;
    const input=document.createElement('input'); input.type=type; input.dataset.field=key;input.value=text;
    label.append(input);grid.append(label);
  };
  textInput('key','資料鍵（英文 ID）',field.key);
  textInput('label','欄位名稱',field.label);
  textInput('description','語意說明',field.description||'');
  const kindLabel=document.createElement('label');kindLabel.textContent='資料型別';
  const kind=document.createElement('select');kind.dataset.field='type';
  for(const t of ['text','secret','boolean','date'] as ProfileFieldType[]){
    const opt=document.createElement('option');opt.value=t;opt.textContent=t;kind.append(opt);
  }
  kind.value=field.type;kindLabel.append(kind);grid.append(kindLabel);
  row.append(grid);
  const valueLabel=document.createElement('label');valueLabel.textContent='實際資料值';
  const valueInput=document.createElement('input');valueInput.dataset.field='value';valueInput.value=field.value;
  valueInput.type=field.type==='secret'?'password':'text';
  kind.addEventListener('change',()=>{valueInput.type=kind.value==='secret'?'password':'text';});
  valueLabel.append(valueInput);row.append(valueLabel);
  const buttonRow=document.createElement('div');buttonRow.className='button-row';
  const remove=document.createElement('button');remove.type='button';remove.textContent='移除此欄位';
  remove.addEventListener('click',()=>row.remove());buttonRow.append(remove);row.append(buttonRow);
  el('field-list').append(row);
}
function draw(profile:Profile):void {
  draft=structuredClone(profile);
  el<HTMLInputElement>('profile-name').value=draft.name;
  el('field-list').replaceChildren();
  draft.fields.forEach(addField);
}
async function chooseProfile(id:string):Promise<void>{
  const profile=await rpc<Profile>({type:'getProfile',id});draw(profile);
}
async function loadProfiles(selected?:string):Promise<void>{
  const result=await rpc<{profiles:ProfileSummary[];activeProfileId:string|null}>({type:'listProfiles'});
  const picker=el<HTMLSelectElement>('profile-picker');
  picker.replaceChildren(...result.profiles.map(p=>{
    const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.name;return opt;
  }));
  const id=selected && result.profiles.some(p=>p.id===selected) ? selected : result.activeProfileId;
  if(id) {picker.value=id;await chooseProfile(id);} else draw(emptyProfile());
}
async function load():Promise<void>{
  const state=await rpc<{exists:boolean;unlocked:boolean}>({type:'status'});
  el('create-vault').hidden=state.exists;
  el('unlock-vault').hidden=!state.exists||state.unlocked;
  el('settings').hidden=!state.unlocked;
  if(!state.unlocked) return;
  const provider=await rpc<{accountId:string;hasToken:boolean}>({type:'getProvider'});
  el<HTMLInputElement>('account-id').value=provider.accountId;
  el<HTMLInputElement>('api-token').value='';
  el('provider-status').textContent=provider.hasToken?'已設定 Token':'尚未設定 Token';
  await loadProfiles();
}
async function act(task:()=>Promise<void>):Promise<void>{
  try{notice('處理中…');await task();notice('已完成');}
  catch(error){notice(error instanceof Error?error.message:'發生錯誤',true);}
}

el('export-vault').addEventListener('click',()=>void act(async()=>{
  const envelope=await rpc<unknown>({type:'exportVault'});
  const blob=new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download='decision-formfill-encrypted-backup.json';
  document.body.append(link);link.click();link.remove();
  // Revoke on the next task so the download can begin.
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}));
el('import-vault').addEventListener('click',()=>void act(async()=>{
  const file=el<HTMLInputElement>('import-file').files?.[0];
  const password=el<HTMLInputElement>('import-password').value;
  if(!file||!password)throw new Error('請選擇備份檔案並輸入備份密碼');
  const status=await rpc<{exists:boolean}>({type:'status'});
  if(status.exists&&!confirm('此操作將覆蓋現有的全部 Profile 和 API 設定，確定繼續？'))return;
  const envelope:unknown=JSON.parse(await file.text());
  await rpc({type:'importVault',envelope,password});
  el<HTMLInputElement>('import-password').value='';
  await load();
}));
el('create').addEventListener('click',()=>void act(async()=>{
  const pw=el<HTMLInputElement>('new-password').value;
  if(pw!==el<HTMLInputElement>('confirm-password').value)throw new Error('兩次密碼不同');
  await rpc({type:'createVault',password:pw});
  el<HTMLInputElement>('new-password').value='';el<HTMLInputElement>('confirm-password').value='';
  await load();
}));
el('unlock').addEventListener('click',()=>void act(async()=>{
  await rpc({type:'unlock',password:el<HTMLInputElement>('password').value});
  el<HTMLInputElement>('password').value='';await load();
}));
el('lock').addEventListener('click',()=>void act(async()=>{await rpc({type:'lock'});await load();}));
el('save-provider').addEventListener('click',()=>void act(async()=>{
  await rpc({type:'saveProvider',accountId:el<HTMLInputElement>('account-id').value,
    token:el<HTMLInputElement>('api-token').value||undefined});
  el<HTMLInputElement>('api-token').value='';
  el('provider-status').textContent='已設定 Token';
}));
el<HTMLSelectElement>('profile-picker').addEventListener('change',e=>void act(async()=>{
  const id=(e.target as HTMLSelectElement).value;if(id)await chooseProfile(id);
}));
el('new-profile').addEventListener('click',()=>{draw(emptyProfile());notice('新增 Profile，編輯後請按儲存。');});
el('add-field').addEventListener('click',()=>addField({key:'',label:'',description:'',type:'text',value:''}));
el('save-profile').addEventListener('click',()=>void act(async()=>{
  draft.name=el<HTMLInputElement>('profile-name').value.trim();draft.fields=readFields();
  await rpc({type:'saveProfile',profile:draft});await loadProfiles(draft.id);
}));
el('delete-profile').addEventListener('click',()=>void act(async()=>{
  const current=await rpc<{profiles:ProfileSummary[]}>({type:'listProfiles'});
  if(!current.profiles.some(p=>p.id===draft.id))throw new Error('此 Profile 尚未儲存');
  if(!confirm(`確定刪除 ${draft.name}？`))return;
  await rpc({type:'removeProfile',id:draft.id});await loadProfiles();
}));
void load().catch(e=>notice(String(e),true));
