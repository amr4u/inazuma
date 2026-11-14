import type { RpcRequest, RpcResponse } from '../common/types';

export async function rpc<T = unknown>(request: RpcRequest): Promise<T> {
  const response = await browser.runtime.sendMessage(request) as RpcResponse<T>;
  if (!response || !response.ok) throw new Error(response?.error || '無法連接 Extension 背景程序');
  return response.data;
}
