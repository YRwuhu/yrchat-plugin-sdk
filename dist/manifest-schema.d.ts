export declare const manifestSchema: {
    readonly $schema: 'https://json-schema.org/draft/2020-12/schema';
    readonly $id: 'https://yrchat.local/schemas/plugin-manifest-v2.json';
    readonly title: 'YRChat WASM plugin manifest';
    readonly type: 'object';
    readonly additionalProperties: false;
    readonly required: readonly ['id', 'name', 'description', 'version', 'api_version', 'entry', 'ui', 'permissions'];
    readonly properties: {
        readonly id: {
            readonly type: 'string';
            readonly maxLength: 128;
            readonly pattern: '^[A-Za-z0-9._-]+$';
        };
        readonly name: {
            readonly type: 'string';
            readonly minLength: 1;
        };
        readonly description: {
            readonly type: 'string';
        };
        readonly version: {
            readonly type: 'string';
            readonly pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+';
        };
        readonly api_version: {
            readonly enum: readonly [1, 2];
        };
        readonly reset_on_close: {
            readonly type: 'boolean';
            readonly default: true;
        };
        readonly entry: {
            readonly type: 'string';
            readonly pattern: '^[^/\\\\]+\\.wasm$';
        };
        readonly ui: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly required: readonly ['entry', 'title', 'width', 'height', 'min_width', 'min_height', 'resizable'];
            readonly properties: {
                readonly entry: {
                    readonly type: 'string';
                    readonly pattern: '^ui/(?:[^/\\\\]+/)*[^/\\\\]+\\.html$';
                };
                readonly title: {
                    readonly type: 'string';
                    readonly minLength: 1;
                };
                readonly width: {
                    readonly type: 'number';
                    readonly minimum: 320;
                };
                readonly height: {
                    readonly type: 'number';
                    readonly minimum: 240;
                };
                readonly min_width: {
                    readonly type: 'number';
                    readonly minimum: 320;
                };
                readonly min_height: {
                    readonly type: 'number';
                    readonly minimum: 240;
                };
                readonly resizable: {
                    readonly type: 'boolean';
                };
            };
        };
        readonly permissions: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly ai_chat: {
                    readonly type: 'boolean';
                    readonly default: false;
                };
                readonly ai_vision: {
                    readonly type: 'boolean';
                    readonly default: false;
                };
                readonly character_context: {
                    readonly type: 'boolean';
                    readonly default: false;
                };
            };
        };
    };
};
export default manifestSchema;
//# sourceMappingURL=manifest-schema.d.ts.map