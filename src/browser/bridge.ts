import { capturePage } from './capture';
import { applyActions } from './filler';

export function bootContent(): void {
  browser.runtime.onMessage.addListener((message: any) => {
    if (message?.type === 'capture') return Promise.resolve(capturePage());
    if (message?.type === 'apply') return Promise.resolve(applyActions(message.actions));
    return undefined;
  });
}
