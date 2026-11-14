import type { FieldKind, FormField, PageSnapshot, FormOption } from '../common/types';

let nextId = 1;
const elements = new Map<string, HTMLElement | HTMLInputElement[]>();
const MAX_FIELDS = 180;

function normalized(text: string | null | undefined, max = 180): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function labelOf(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = Array.from(el.labels ?? []);
    if (labels.length) return normalized(labels.map(l => l.textContent).join(' '));
  }
  return normalized(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') &&
    document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent ||
    el.getAttribute('placeholder') || el.getAttribute('title') || '');
}
function contextOf(el: HTMLElement): string {
  const wrapper = el.closest('fieldset, td, li, .form-group, .field, [role="group"]') || el.parentElement;
  const legend = el.closest('fieldset')?.querySelector('legend')?.textContent || '';
  return normalized([legend, wrapper?.textContent].filter(Boolean).join(' | '), 240);
}
function kindOf(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FieldKind {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el.type === 'checkbox') return 'checkbox';
  if (el.type === 'radio') return 'radio';
  if (el.type === 'date') return 'date';
  return 'text';
}
function selectable(el: Element): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || ('readOnly' in el && el.readOnly) || el.closest('[inert]')) return false;
  if (el instanceof HTMLInputElement && ['hidden','submit','button','reset','file','image','color','range'].includes(el.type)) return false;
  return true;
}
function extractOptions(el: HTMLSelectElement): FormOption[] {
  return Array.from(el.options).slice(0, 100).map(o => ({ value:o.value, label:normalized(o.textContent) }));
}

export function capturePage(): PageSnapshot {
  elements.clear();
  nextId = 1;
  const fields: FormField[] = [];
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const controls = Array.from(document.querySelectorAll('input, select, textarea')).filter(selectable) as
    Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  for (const el of controls) {
    if (fields.length >= MAX_FIELDS) break;
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const groupKey = `${el.form?.id || ''}\0${el.name || el.id}`;
      if (!radioGroups.has(groupKey)) radioGroups.set(groupKey, []);
      radioGroups.get(groupKey)!.push(el);
      continue;
    }
    const id = `f${nextId++}`;
    elements.set(id, el);
    fields.push({
      id, kind:kindOf(el), inputType:el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
      label:labelOf(el), name:el.getAttribute('name') ?? '', placeholder:el.getAttribute('placeholder') ?? '',
      autocomplete:el.getAttribute('autocomplete') ?? '', context:contextOf(el),
      filled:el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : Boolean(el.value),
      required:el.required,
      options:el instanceof HTMLSelectElement ? extractOptions(el) : undefined,
    });
  }
  for (const radios of radioGroups.values()) {
    if (fields.length >= MAX_FIELDS) break;
    const first = radios[0];
    const id = `f${nextId++}`;
    elements.set(id, radios);
    fields.push({
      id, kind:'radio', inputType:'radio', label:labelOf(first) || contextOf(first), name:first.name,
      placeholder:'', autocomplete:'', context:contextOf(first), required:radios.some(r => r.required),
      filled:radios.some(r => r.checked),
      options:radios.map(r => ({ value:r.value, label:labelOf(r) || r.value })),
    });
  }
  return { url:location.href, title:document.title.slice(0, 120), fields };
}

export function resolveElement(id: string): HTMLElement | HTMLInputElement[] | undefined { return elements.get(id); }
