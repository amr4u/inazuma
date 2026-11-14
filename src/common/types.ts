/** No browser, storage, or provider specifics may leak into this contract. */
export type FieldKind = 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date';

export interface FormOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  kind: FieldKind;
  inputType: string;
  label: string;
  name: string;
  placeholder: string;
  autocomplete: string;
  context: string;
  filled: boolean;
  required: boolean;
  options?: FormOption[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  fields: FormField[];
}

export type ProfileFieldType = 'text' | 'secret' | 'boolean' | 'date';

export interface ProfileField {
  key: string;
  label: string;
  description?: string;
  type: ProfileFieldType;
  value: string;
}

export interface Profile {
  id: string;
  name: string;
  fields: ProfileField[];
}

export interface ProfileSummary { id: string; name: string; fieldCount: number }
export type ProfileFieldSchema = Omit<ProfileField, 'value'>;
export interface ProfileSchema { id: string; name: string; fields: ProfileFieldSchema[] }

export interface FieldDecision {
  fieldId: string;
  profileKey: string | null;
  score?: number;
}
export interface DecisionPlan {
  fields: FieldDecision[];
  providerId: string;
}

export interface FillAction {
  fieldId: string;
  value: string;
}
export interface FillReport {
  applied: number;
  skipped: number;
  details: string[];
}

export interface ProviderConfig {
  id: string;
  kind: 'cloudflare-clef-omni';
  accountId: string;
  token: string;
}

export interface VaultDocument {
  schemaVersion: 1;
  profiles: Profile[];
  activeProfileId: string | null;
  providers: ProviderConfig[];
  activeProviderId: string | null;
}

export type RpcRequest =
  | { type: 'status' }
  | { type: 'createVault'; password: string }
  | { type: 'exportVault' }
  | { type: 'importVault'; envelope: unknown; password: string }
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'listProfiles' }
  | { type: 'getProfile'; id: string }
  | { type: 'saveProfile'; profile: Profile }
  | { type: 'removeProfile'; id: string }
  | { type: 'selectProfile'; id: string }
  | { type: 'getProvider' }
  | { type: 'saveProvider'; accountId: string; token?: string }
  | { type: 'fill'; overwrite?: boolean };

export type RpcResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
