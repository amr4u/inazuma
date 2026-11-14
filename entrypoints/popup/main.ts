import { rpc } from '../../src/app/rpc';
import type { ProfileSummary } from '../../src/common/types';

interface Status { exists:boolean; unlocked:boolean; profiles:ProfileSummary[]; activeProfileId:string|null; providerConfigured:boolean }
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const message = (text: string, error=false) => { element('message').textContent=text; element('message').className=`status ${error?'error':''}`; };
const busy = (value:boolean) => { (element<HTMLButtonElement>('fill')).disabled=value; (element<HTMLButtonElement>('unlock')).disabled=value; };

async function load(): Promise<void> {
  const state = await rpc<Status>({type:'status'});
  element('uninitialized').hidden = state.exists;
  element('locked').hidden = !state.exists || state.unlocked;
  element('ready').hidden = !state.unlocked;
  if (!state.unlocked) return;
  const select = element<HTMLSelectElement>('profiles');
  select.replaceChildren(...state.profiles.map(p => {
    const option = document.createElement('option'); option.value=p.id; option.textContent=`${p.name}（${p.fieldCount} 欄位）`; return option;
  }));
  if (state.activeProfileId) select.value=state.activeProfileId;
  message(!state.providerConfigured ? '請先在設定中提供 Cloudflare API 資訊。' :
    !state.profiles.length ? '請先建立 Profile。' : '可以開始填寫表單。');
}

async function callAndRefresh(work:()=>Promise<unknown>):Promise<void> {
  try { message('處理中…'); await work(); await load(); }
  catch(e) { message(e instanceof Error ? e.message : '發生錯誤',true); }
}

element('setup').addEventListener('click',()=>void browser.runtime.openOptionsPage());
element('open-options').addEventListener('click',()=>void browser.runtime.openOptionsPage());
element('unlock').addEventListener('click',()=>void callAndRefresh(async()=> {
  await rpc({type:'unlock',password:element<HTMLInputElement>('unlock-password').value});
  element<HTMLInputElement>('unlock-password').value='';
}));
element('lock').addEventListener('click',()=>void callAndRefresh(()=>rpc({type:'lock'})));
element<HTMLSelectElement>('profiles').addEventListener('change',ev=>void callAndRefresh(() =>
  rpc({type:'selectProfile',id:(ev.target as HTMLSelectElement).value})));
element('fill').addEventListener('click',async()=>{
  busy(true);
  try {
    message('正在分析目前網頁並填寫…');
    const result = await rpc<{analyzed:number;planned:number;skipped:number;report:{applied:number;skipped:number;details:string[]}}>({
      type:'fill', overwrite:element<HTMLInputElement>('overwrite').checked,
    });
    message(`分析 ${result.analyzed} 欄；完成 ${result.report.applied} 欄；未填 ${result.analyzed-result.report.applied} 欄。${result.report.details.slice(0,2).join('；')}`);
  } catch(e) { message(e instanceof Error ? e.message:'操作失敗',true); }
  finally {busy(false);}
});
void load().catch(e=>message(String(e),true));
