# YRChat Plugin SDK

This repository contains `@yrchat/plugin-vite`, the browser-side `@yrchat/plugin-sdk`, and the `yrchat-plugin-sdk` Rust crate.

Plugin UIs use the separate `@yrchat/plugin-sdk` package instead of depending on Tauri APIs directly:

```ts
import { createPluginClient } from '@yrchat/plugin-sdk';

const host = createPluginClient('dev.example.my-plugin');
const result = await host.invoke<{ value: string }>('start', { difficulty: 'easy' });
await host.close();
```

Pass a `fallback` adapter to `createPluginClient` when the UI needs mock behavior in a
regular browser during development. The adapter is ignored when the UI runs in YRChat.

```ts
import { defineConfig } from 'vite';
import yrchatPlugin from '@yrchat/plugin-vite';

export default defineConfig({
  plugins: [yrchatPlugin({ manifest: 'manifest.json', crate: 'src-plugin/Cargo.toml' })],
});
```

```rust
use yrchat_plugin_sdk::{export_plugin, Plugin};

#[derive(Default)]
struct MyPlugin;

impl Plugin for MyPlugin {
    // Implement handle and resume.
}

export_plugin!(MyPlugin);
```

`vite build` builds the UI, compiles the Rust crate for `wasm32-unknown-unknown`, validates the plugin manifest, and creates a reproducible `.yrplugin` archive.
