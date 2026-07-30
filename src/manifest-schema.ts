export const manifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://yrchat.local/schemas/plugin-manifest-v2.json',
  title: 'YRChat WASM plugin manifest',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description', 'version', 'api_version', 'entry', 'ui', 'permissions'],
  properties: {
    id: { type: 'string', maxLength: 128, pattern: '^[A-Za-z0-9._-]+$' },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+' },
    api_version: { enum: [1, 2] },
    reset_on_close: { type: 'boolean', default: true },
    entry: { type: 'string', pattern: '^[^/\\\\]+\\.wasm$' },
    ui: {
      type: 'object',
      additionalProperties: false,
      required: ['entry', 'title', 'width', 'height', 'min_width', 'min_height', 'resizable'],
      properties: {
        entry: { type: 'string', pattern: '^ui/(?:[^/\\\\]+/)*[^/\\\\]+\\.html$' },
        title: { type: 'string', minLength: 1 },
        width: { type: 'number', minimum: 320 },
        height: { type: 'number', minimum: 240 },
        min_width: { type: 'number', minimum: 320 },
        min_height: { type: 'number', minimum: 240 },
        resizable: { type: 'boolean' },
      },
    },
    permissions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ai_chat: { type: 'boolean', default: false },
        ai_vision: { type: 'boolean', default: false },
        character_context: { type: 'boolean', default: false },
      },
    },
  },
} as const;

export default manifestSchema;
