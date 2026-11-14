import type { DecisionPlan, FillAction, FormField, PageSnapshot, Profile } from '../common/types';

/** Resolves local values only after the decision API has returned keys. */
export function resolveActions(
  snapshot: PageSnapshot, plan: DecisionPlan, profile: Profile, overwrite = false,
): { actions: FillAction[]; skipped: number } {
  const fields = new Map<string, FormField>(snapshot.fields.map(f => [f.id, f]));
  const values = new Map(profile.fields.map(f => [f.key, f.value]));
  const actions: FillAction[] = [];
  let skipped = 0;
  for (const decision of plan.fields) {
    const field = fields.get(decision.fieldId);
    const value = decision.profileKey ? values.get(decision.profileKey) : undefined;
    if (!field || value === undefined || value === '' || (field.filled && !overwrite)) { skipped++; continue; }
    // Selection happens in the DOM executor, which has the real select/radio options.
    actions.push({ fieldId: field.id, value });
  }
  return { actions, skipped };
}
