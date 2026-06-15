declare module 'markdown-it-texmath' {
  import type MarkdownIt from 'markdown-it';

  interface TexmathOptions {
    engine?: unknown;
    delimiters?: string | string[];
    outerSpace?: boolean;
    katexOptions?: Record<string, unknown>;
    macros?: Record<string, string>;
  }

  const texmath: MarkdownIt.PluginWithOptions<TexmathOptions>;
  export default texmath;
}
