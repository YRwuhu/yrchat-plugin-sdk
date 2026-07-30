# YRChat Plugin SDK

Browser-side host bridge for YRChat plugin UIs.

```ts
import { createPluginClient } from '@yrchat/plugin-sdk';

const host = createPluginClient('dev.example.my-plugin');
const result = await host.invoke<{ value: string }>('start', { difficulty: 'easy' });
await host.close();
```

Plugins should use this package instead of importing Tauri APIs directly. A `fallback`
adapter can provide mock behavior when the UI runs in a regular browser during development.
