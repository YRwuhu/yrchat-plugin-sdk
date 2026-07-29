# YRChat Plugin SDK

This repository contains `@yrchat/plugin-vite` and the `yrchat-plugin-sdk` Rust crate.

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
