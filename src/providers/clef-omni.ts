import type { PageSnapshot, ProfileSchema, DecisionPlan, FieldDecision } from '../common/types';
import type { DecisionProvider } from '../decision/provider';

interface ClefChoiceAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface ClefEnvelope {
  success?: boolean;
  errors?: Array<{message?: string}>;
  result?: { answers?: Record<string, ClefChoiceAnswer> };
  answers?: Record<string, ClefChoiceAnswer>;
}

const MAX_QUESTIONS = 64;
const MAX_OPTIONS = 255;

export class CloudflareClefOmniProvider implements DecisionProvider {
  readonly id = 'cloudflare-clef-omni';
  constructor(private readonly accountId: string, private readonly token: string,
    private readonly request: typeof fetch = fetch) {}

  async decide(snapshot: PageSnapshot, schema: ProfileSchema): Promise<DecisionPlan> {
    const fields = snapshot.fields;
    if (!fields.length) return { providerId: this.id, fields: [] };
    if (schema.fields.length + 1 > MAX_OPTIONS) throw new Error('Profile 欄位數超出目前 Clef Adapter 支援範圍');
    if (!schema.fields.length) throw new Error('所選 Profile 尚未建立欄位');
    const decisions: FieldDecision[] = [];
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/@cf/cloudflare/clef-omni`;

    for (let start = 0; start < fields.length; start += MAX_QUESTIONS) {
      const chunk = fields.slice(start, start + MAX_QUESTIONS);
      const criteria: Record<string, string> = {
        skip: 'The input should remain unfilled: unrelated, uncertain, promotional opt-in or no appropriate profile field.',
      };
      for (let i = 0; i < schema.fields.length; i++) {
        const field = schema.fields[i];
        criteria[`p${i}`] = `${field.label}. Key: ${field.key}. ${field.description ?? ''}. Data type: ${field.type}`;
      }
      const questions: Record<string, unknown> = {};
      for (let i = 0; i < chunk.length; i++) {
        questions[`f${i}`] = {
          type: 'choice',
          instructions: `For DOM element ${chunk[i].id}, choose the corresponding user's profile field. Use context of neighboring elements and grouped labels, not only its own name. Choose skip if not confidently related.`,
          criteria,
        };
      }
      const state = {
        task: 'Analyze a complete web form and choose values to fill, using only the provided profile field descriptions. The state contains no profile values.',
        page: { url: safePageUrl(snapshot.url), title: snapshot.title },
        // Include all fields for contextual understanding, even if questions are batched.
        fields: fields.map(f => ({...f, options: f.options?.slice(0, 32)})),
      };
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'clef-omni', state, questions }),
      });
      let envelope: ClefEnvelope;
      try { envelope = await response.json() as ClefEnvelope; }
      catch { throw new Error(`Decision API 回應格式無效（HTTP ${response.status}）`); }
      if (!response.ok || envelope.success === false) {
        const reason = envelope.errors?.map(e => e.message).filter(Boolean).join('; ');
        throw new Error(`Decision API 請求失敗（HTTP ${response.status}）${reason ? `：${reason}` : ''}`);
      }
      const answers = envelope.result?.answers ?? envelope.answers;
      if (!answers) throw new Error('Decision API 回應缺少 answers');
      for (let i = 0; i < chunk.length; i++) {
        const answer = answers[`f${i}`];
        if (!answer || typeof answer.choice !== 'string') continue;
        const code = answer.choice;
        const index = /^p\d+$/.test(code) ? Number(code.slice(1)) : -1;
        const key = index >= 0 && index < schema.fields.length ? schema.fields[index].key : null;
        decisions.push({ fieldId: chunk[i].id, profileKey: key,
          score: typeof answer.confidence === 'number' ? answer.confidence : undefined });
      }
    }
    return { providerId: this.id, fields: decisions };
  }
}

/** Do not send URL query parameters (which may contain temporary tokens). */
function safePageUrl(input: string): string {
  try { const url = new URL(input); return `${url.origin}${url.pathname}`; }
  catch { return ''; }
}
