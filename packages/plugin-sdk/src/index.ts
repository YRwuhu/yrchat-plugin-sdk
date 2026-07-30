import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type PluginPayload = Record<string, unknown>;

export interface PluginHostAdapter {
  invoke<T>(operation: string, payload: PluginPayload): Promise<T>;
  close(): Promise<void>;
}

export interface PluginClientOptions {
  /** Used outside YRChat, for example by a Vite development preview. */
  fallback?: PluginHostAdapter;
}

export interface PluginClient {
  invoke<T>(operation: string, payload?: PluginPayload): Promise<T>;
  close(): Promise<void>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

function hasTauriHost(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as TauriWindow);
}

function validatePluginId(pluginId: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(pluginId)) {
    throw new Error(`Invalid YRChat plugin ID: ${pluginId}`);
  }
}

function unavailable(): never {
  throw new Error('YRChat plugin host is unavailable');
}

/** Creates the host bridge used by a plugin UI. */
export function createPluginClient(
  pluginId: string,
  options: PluginClientOptions = {},
): PluginClient {
  validatePluginId(pluginId);

  return {
    async invoke<T>(operation: string, payload: PluginPayload = {}): Promise<T> {
      if (!operation.trim()) throw new Error('Plugin operation must not be empty');
      if (hasTauriHost()) {
        return tauriInvoke<T>('invoke_plugin', { pluginId, operation, payload });
      }
      return options.fallback?.invoke<T>(operation, payload) ?? unavailable();
    },

    async close(): Promise<void> {
      if (hasTauriHost()) {
        await tauriInvoke<void>('close_plugin');
        return;
      }
      if (options.fallback) {
        await options.fallback.close();
        return;
      }
      unavailable();
    },
  };
}
