/** Minimal Firefox WebExtensions types; replace with @types/firefox-webext-browser in a larger project. */
declare const browser: {
  runtime: {
    getURL(path: string): string;
    openOptionsPage(): Promise<void>;
    sendMessage(message: unknown): Promise<any>;
    onMessage: { addListener(listener: (message: any, sender: {url?: string; id?: string}) => Promise<any> | any): void };
  };
  storage: { local: { get(key: string): Promise<Record<string, any>>; set(value: Record<string, any>): Promise<void> } };
  tabs: {
    query(query: {active: boolean; currentWindow: boolean}): Promise<Array<{id?: number; url?: string}>>;
    sendMessage(tabId: number, message: unknown): Promise<any>;
  };
};
