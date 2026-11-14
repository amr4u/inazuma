import type { DecisionPlan, PageSnapshot, ProfileSchema } from '../common/types';

/** The single extension point for alternative decision APIs. */
export interface DecisionProvider {
  readonly id: string;
  decide(snapshot: PageSnapshot, schema: ProfileSchema): Promise<DecisionPlan>;
}

export class DecisionEngine {
  constructor(private readonly provider: DecisionProvider) {}
  async decide(snapshot: PageSnapshot, schema: ProfileSchema): Promise<DecisionPlan> {
    if (!snapshot.fields.length) return { providerId: this.provider.id, fields: [] };
    const result = await this.provider.decide(snapshot, schema);
    // Only keep choices that exist in this snapshot/profile; provider output is untrusted.
    const knownFields = new Set(snapshot.fields.map(f => f.id));
    const knownKeys = new Set(schema.fields.map(f => f.key));
    const seen = new Set<string>();
    return { providerId: this.provider.id, fields: result.fields.filter(f => {
      if (!knownFields.has(f.fieldId) || seen.has(f.fieldId)) return false;
      if (f.profileKey !== null && !knownKeys.has(f.profileKey)) return false;
      seen.add(f.fieldId);
      return true;
    }) };
  }
}
