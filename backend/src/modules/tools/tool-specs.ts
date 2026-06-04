export const CODING_TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and folders in a project workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path inside the project.' },
          maxDepth: { type: 'number', description: 'Maximum tree depth.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the project workspace.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Relative file path inside the project.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description: 'Search for text inside project files.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          path: { type: 'string' },
          maxResults: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_patch',
      description:
        'Replace or create one or more files with proposed full file content. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path for a single-file patch. Prefer files for multi-file edits.',
          },
          content: {
            type: 'string',
            description: 'Full target file content for a single-file patch.',
          },
          files: {
            type: 'array',
            description: 'Multi-file patch set. Each item is full target file content for one path.',
            items: {
              type: 'object',
              required: ['path', 'content'],
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
          reason: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run an allowlisted command in the project workspace. Requires user approval.',
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
];
