import type { SettingsDestination } from '../../contracts/settings-search';

export function focusSettingsDestination(section: HTMLElement, destination: SettingsDestination): void {
  if (!destination.focusLabel) { section.scrollTop = 0; section.focus({ preventScroll: true }); return; }
  const label = [...section.querySelectorAll<HTMLElement>('.field-label,.toggle-label > span:first-child,button,h3,h4')].find(element => element.getClientRects().length && (element.textContent?.trim() === destination.focusLabel || (destination.id === 'models:添加模型连接' && element.textContent?.trim() === '添加连接')));
  const region = label?.closest<HTMLElement>('.field,.toggle-label,.settings-row,.section-heading') ?? label ?? section;
  const control = label?.matches('button:not(:disabled)') ? label : region.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)');
  const target = control ?? section;
  region.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  target.focus({ preventScroll: true });
  const visual = control?.matches('input[role="switch"]') ? control.nextElementSibling : control;
  if (visual) {
    const box = visual.getBoundingClientRect(); const bounds = section.getBoundingClientRect();
    if (box.top < bounds.top + 8) section.scrollTop += box.top - bounds.top - 8;
    else if (box.bottom > bounds.bottom - 8) section.scrollTop += box.bottom - bounds.bottom + 8;
  }
}
