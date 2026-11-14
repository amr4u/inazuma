import type { FillAction, FillReport } from '../common/types';
import { resolveElement } from './capture';

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s\-－]/g, '');
}
function inputEvent(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles:true }));
  el.dispatchEvent(new Event('change', { bubbles:true }));
}
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  inputEvent(el);
}
function findOption(value: string, options: Array<{value: string; label: string}>): string | undefined {
  const target = normalize(value);
  return options.find(o => normalize(o.value) === target || normalize(o.label) === target)?.value;
}
function applyOne(el: HTMLElement | HTMLInputElement[], value: string): boolean {
  if (Array.isArray(el)) {
    const target = findOption(value, el.map(r => ({value:r.value, label:r.labels?.[0]?.textContent?.trim() || r.value})));
    if (target === undefined) return false;
    const radio = el.find(r => r.value === target);
    if (!radio || radio.disabled) return false;
    radio.checked = true;
    inputEvent(radio);
    return true;
  }
  if (!el.isConnected) return false;
  if (el instanceof HTMLSelectElement) {
    const choice = findOption(value, Array.from(el.options).map(o => ({value:o.value,label:o.textContent || ''})));
    if (choice === undefined) return false;
    el.value = choice;
    inputEvent(el);
    return true;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') {
      const truth = ['true','yes','1','on','是','はい','checked'].includes(normalize(value));
      const falsehood = ['false','no','0','off','否','いいえ','unchecked'].includes(normalize(value));
      if (!truth && !falsehood) return false;
      el.checked = truth;
      inputEvent(el);
      return true;
    }
    if (el.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    setNativeValue(el, value);
    return true;
  }
  if (el instanceof HTMLTextAreaElement) { setNativeValue(el, value); return true; }
  return false;
}

export function applyActions(actions: FillAction[]): FillReport {
  const details: string[] = [];
  let applied = 0;
  for (const action of actions) {
    const el = resolveElement(action.fieldId);
    if (!el) { details.push(`${action.fieldId}: element no longer available`); continue; }
    try {
      if (applyOne(el, action.value)) applied++;
      else details.push(`${action.fieldId}: unsupported control or option not found`);
    } catch {
      details.push(`${action.fieldId}: page rejected input`);
    }
  }
  return { applied, skipped:actions.length - applied, details };
}
