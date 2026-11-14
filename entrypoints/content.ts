import { bootContent } from '../src/browser/bridge';
export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  runAt: 'document_idle',
  main() { bootContent(); },
});
