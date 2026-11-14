import type { FillReport, PageSnapshot, Profile, RpcRequest, RpcResponse } from '../common/types';
import { BrowserProfileRepository } from '../profile/repository';
import { ProfileVault } from '../profile/vault';
import { ProfileService } from '../profile/service';
import { CloudflareClefOmniProvider } from '../providers/clef-omni';
import { DecisionEngine } from '../decision/provider';
import { resolveActions } from '../decision/resolve';

const vault = new ProfileVault(new BrowserProfileRepository());
const profiles = new ProfileService(vault);

async function fill(overwrite: boolean): Promise<{report: FillReport; analyzed: number; planned: number; skipped: number}> {
  const profile = profiles.getActiveProfile();
  const config = profiles.getProvider();
  const tabs = await browser.tabs.query({active:true, currentWindow:true});
  const tab = tabs[0];
  if (tab?.id === undefined) throw new Error('找不到目前分頁');
  let snapshot: PageSnapshot;
  try { snapshot = await browser.tabs.sendMessage(tab.id, { type:'capture' }); }
  catch { throw new Error('此頁面無法執行 Extension（例如 Firefox 內部頁面）'); }
  if (!snapshot?.fields?.length) throw new Error('目前頁面沒有可辨識的輸入欄位');
  const provider = new CloudflareClefOmniProvider(config.accountId, config.token);
  const plan = await new DecisionEngine(provider).decide(snapshot, profiles.getSchema(profile.id));
  const resolved = resolveActions(snapshot, plan, profile, overwrite);
  const report: FillReport = await browser.tabs.sendMessage(tab.id, {type:'apply', actions:resolved.actions});
  return { report, analyzed:snapshot.fields.length, planned:resolved.actions.length,
    skipped:resolved.skipped };
}

async function respond(request: RpcRequest): Promise<unknown> {
  switch (request.type) {
    case 'status': {
      const exists = await vault.exists();
      const unlocked = vault.isUnlocked();
      const doc = unlocked ? vault.read() : null;
      return { exists, unlocked, profiles:doc?.profiles.map(p => ({ id:p.id,name:p.name,fieldCount:p.fields.length })) ?? [],
        activeProfileId: doc?.activeProfileId ?? null, providerConfigured:Boolean(doc?.providers.some(p => p.accountId && p.token)) };
    }
    case 'createVault': await vault.create(request.password); return null;
    case 'exportVault': return vault.exportEncrypted();
    case 'importVault': await vault.importEncrypted(request.envelope as any, request.password); return null;
    case 'unlock': await vault.unlock(request.password); return null;
    case 'lock': vault.lock(); return null;
    case 'listProfiles': return { profiles:profiles.list(), activeProfileId:profiles.getActiveId() };
    case 'getProfile': return profiles.get(request.id);
    case 'saveProfile': await profiles.save(request.profile as Profile); return null;
    case 'removeProfile': await profiles.remove(request.id); return null;
    case 'selectProfile': await profiles.select(request.id); return null;
    case 'getProvider': return profiles.getProviderSummary();
    case 'saveProvider': await profiles.saveProvider(request.accountId, request.token); return null;
    case 'fill': return fill(Boolean(request.overwrite));
    default: throw new Error('未知指令');
  }
}

export function bootBackground(): void {
  browser.runtime.onMessage.addListener(async (request: RpcRequest, sender: {url?:string}): Promise<RpcResponse> => {
    // Only extension pages may access vault RPC. Content scripts use the separate tab message channel.
    const selfOrigin = browser.runtime.getURL('');
    if (!sender.url?.startsWith(selfOrigin)) return { ok:false, error:'此來源無權呼叫 Profile API' };
    try { return { ok:true, data:await respond(request) }; }
    catch (error) { return { ok:false, error:error instanceof Error ? error.message : '操作失敗' }; }
  });
}
