import { parseMath } from '@unified-latex/unified-latex-util-parse';

type LatexNode = ReturnType<typeof parseMath>[number];
type LatexArgument = {
  content: LatexNode[];
  openMark?: string;
  closeMark?: string;
};
type LatexMacro = Extract<LatexNode, { type: 'macro' }>;

interface ParsedDisplayMath {
  latex: string;
  nextIndex: number;
  collapseEscapedBackslashes: boolean;
}

interface RenderTerminalMathOptions {
  collapseEscapedBackslashes?: boolean;
}

const fencedCodePattern = /^ {0,3}(```|~~~)/;
const singleBracketOpen = '\\[';
const singleBracketClose = '\\]';
const doubleBracketOpen = '\\\\[';
const doubleBracketClose = '\\\\]';

const passthroughMacros = new Set(['text', 'textrm', 'textit', 'textbf', 'mathrm', 'mathbf', 'operatorname']);
const spacingMacros = new Set([',', ';', ':', 'quad', 'qquad']);

const latexMacroReplacements: Record<string, string> = {
  cdot: '\u00b7',
  times: '\u00d7',
  div: '\u00f7',
  pm: '\u00b1',
  mp: '\u2213',
  le: '\u2264',
  leq: '\u2264',
  ge: '\u2265',
  geq: '\u2265',
  neq: '\u2260',
  approx: '\u2248',
  infty: '\u221e',
  rightarrow: '\u2192',
  to: '\u2192',
  leftarrow: '\u2190',
  Rightarrow: '\u21d2',
  Leftarrow: '\u21d0',
  leftrightarrow: '\u2194',
  sum: '\u2211',
  prod: '\u220f',
  int: '\u222b',
  partial: '\u2202',
  nabla: '\u2207',
  sqrt: '\u221a',
  cdots: '...',
  ldots: '...',
  dots: '...',
  circ: '\u2218',
  degree: '\u00b0',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  log: 'log',
  ln: 'ln',
  alpha: '\u03b1',
  Alpha: '\u0391',
  beta: '\u03b2',
  Beta: '\u0392',
  gamma: '\u03b3',
  Gamma: '\u0393',
  delta: '\u03b4',
  Delta: '\u0394',
  epsilon: '\u03b5',
  varepsilon: '\u03b5',
  zeta: '\u03b6',
  eta: '\u03b7',
  theta: '\u03b8',
  Theta: '\u0398',
  lambda: '\u03bb',
  Lambda: '\u039b',
  mu: '\u03bc',
  pi: '\u03c0',
  Pi: '\u03a0',
  rho: '\u03c1',
  sigma: '\u03c3',
  Sigma: '\u03a3',
  phi: '\u03c6',
  varphi: '\u03c6',
  Phi: '\u03a6',
  omega: '\u03c9',
  Omega: '\u03a9',
};

export function preprocessMarkdownMath(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fencedCodePattern.test(line.trimEnd())) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }

    if (inCodeBlock) {
      output.push(line);
      continue;
    }

    const parsedBlock = parseDisplayMath(lines, index);
    if (parsedBlock) {
      output.push(
        renderTerminalMath(parsedBlock.latex, {
          collapseEscapedBackslashes: parsedBlock.collapseEscapedBackslashes,
        }),
      );
      index = parsedBlock.nextIndex - 1;
      continue;
    }

    output.push(preprocessInlineMath(line));
  }

  return output.join('\n');
}

function preprocessInlineMath(line: string): string {
  return replaceDollarInlineMath(replaceParenInlineMath(line));
}

function replaceParenInlineMath(line: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < line.length) {
    const start = findParenInlineStart(line, cursor);
    if (!start) {
      output += line.slice(cursor);
      break;
    }

    const end = line.indexOf(start.closeDelimiter, start.index + start.openDelimiter.length);
    if (end === -1) {
      output += line.slice(cursor);
      break;
    }

    const latex = line.slice(start.index + start.openDelimiter.length, end);
    output += line.slice(cursor, start.index);
    output += renderTerminalMath(latex, { collapseEscapedBackslashes: start.collapseEscapedBackslashes });
    cursor = end + start.closeDelimiter.length;
  }

  return output;
}

function findParenInlineStart(
  value: string,
  fromIndex: number,
): { index: number; openDelimiter: string; closeDelimiter: string; collapseEscapedBackslashes: boolean } | null {
  for (let index = fromIndex; index < value.length; index += 1) {
    if (value.startsWith('\\\\(', index)) {
      return { index, openDelimiter: '\\\\(', closeDelimiter: '\\\\)', collapseEscapedBackslashes: true };
    }
    if (value.startsWith('\\(', index)) {
      return { index, openDelimiter: '\\(', closeDelimiter: '\\)', collapseEscapedBackslashes: false };
    }
  }
  return null;
}

function replaceDollarInlineMath(line: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < line.length) {
    const start = findInlineDollarStart(line, cursor);
    if (start === -1) {
      output += line.slice(cursor);
      break;
    }

    const end = findInlineDollarEnd(line, start + 1);
    if (end === -1) {
      output += line.slice(cursor);
      break;
    }

    const latex = line.slice(start + 1, end);
    if (!looksLikeInlineMath(latex)) {
      output += line.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }

    output += line.slice(cursor, start);
    output += renderTerminalMath(latex);
    cursor = end + 1;
  }

  return output;
}

function findInlineDollarStart(value: string, fromIndex: number): number {
  for (let index = fromIndex; index < value.length; index += 1) {
    if (value[index] !== '$') continue;
    if (value[index + 1] === '$') {
      index += 1;
      continue;
    }
    if (value[index - 1] === '\\') continue;
    if (/\d/.test(value[index + 1] ?? '')) continue;
    return index;
  }
  return -1;
}

function findInlineDollarEnd(value: string, fromIndex: number): number {
  for (let index = fromIndex; index < value.length; index += 1) {
    if (value[index] !== '$') continue;
    if (value[index + 1] === '$') {
      index += 1;
      continue;
    }
    if (value[index - 1] === '\\') continue;
    return index;
  }
  return -1;
}

function looksLikeInlineMath(latex: string): boolean {
  const trimmed = latex.trim();
  if (!trimmed || /\n/.test(trimmed)) return false;
  return /\\{1,2}[a-zA-Z]+|[_^{}=+\-*/<>]|[A-Za-z]\s*=/.test(trimmed);
}

function parseDisplayMath(lines: string[], index: number): ParsedDisplayMath | null {
  const trimmed = lines[index]?.trim() ?? '';

  const bracketBlock =
    parseBracketDisplayMath(lines, index, trimmed, doubleBracketOpen, doubleBracketClose, true) ??
    parseBracketDisplayMath(lines, index, trimmed, singleBracketOpen, singleBracketClose, false);
  if (bracketBlock) return bracketBlock;

  if (trimmed === '$$') return parseDelimitedMath(lines, index, '$$', '', false);
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
    return {
      latex: trimmed.slice(2, -2).trim(),
      nextIndex: index + 1,
      collapseEscapedBackslashes: false,
    };
  }
  if (trimmed.startsWith('$$')) return parseDelimitedMath(lines, index, '$$', trimmed.slice(2).trim(), false);

  const beginMatch = trimmed.match(/^(\\{1,2})begin\{([^}]+)}/);
  if (beginMatch) {
    const prefix = beginMatch[1]!;
    return parseEnvironmentMath(lines, index, beginMatch[2]!, trimmed, prefix.length === 2);
  }

  return null;
}

function parseBracketDisplayMath(
  lines: string[],
  index: number,
  trimmed: string,
  openDelimiter: string,
  closeDelimiter: string,
  collapseEscapedBackslashes: boolean,
): ParsedDisplayMath | null {
  if (trimmed === openDelimiter) {
    return parseDelimitedMath(lines, index, closeDelimiter, '', collapseEscapedBackslashes);
  }
  if (trimmed.startsWith(openDelimiter) && trimmed.endsWith(closeDelimiter) && trimmed.length >= openDelimiter.length + closeDelimiter.length) {
    return {
      latex: trimmed.slice(openDelimiter.length, -closeDelimiter.length).trim(),
      nextIndex: index + 1,
      collapseEscapedBackslashes,
    };
  }
  if (trimmed.startsWith(openDelimiter)) {
    return parseDelimitedMath(lines, index, closeDelimiter, trimmed.slice(openDelimiter.length).trim(), collapseEscapedBackslashes);
  }
  return null;
}

function parseDelimitedMath(
  lines: string[],
  index: number,
  closingDelimiter: string,
  firstLineContent: string,
  collapseEscapedBackslashes: boolean,
): ParsedDisplayMath {
  const mathLines: string[] = firstLineContent ? [firstLineContent] : [];
  let cursor = index + 1;

  while (cursor < lines.length) {
    const line = lines[cursor] ?? '';
    if (line.trim() === closingDelimiter) {
      return {
        latex: mathLines.join('\n').trim(),
        nextIndex: cursor + 1,
        collapseEscapedBackslashes,
      };
    }
    mathLines.push(line);
    cursor += 1;
  }

  return {
    latex: mathLines.join('\n').trim(),
    nextIndex: cursor,
    collapseEscapedBackslashes,
  };
}

function parseEnvironmentMath(
  lines: string[],
  index: number,
  environmentName: string,
  firstLine: string,
  collapseEscapedBackslashes: boolean,
): ParsedDisplayMath {
  const escapePrefix = collapseEscapedBackslashes ? '\\\\' : '\\';
  const closingDelimiter = `${escapePrefix}end{${environmentName}}`;
  const mathLines = [firstLine];
  let cursor = index + 1;

  if (firstLine.includes(closingDelimiter)) {
    return { latex: firstLine, nextIndex: index + 1, collapseEscapedBackslashes };
  }

  while (cursor < lines.length) {
    const line = lines[cursor] ?? '';
    mathLines.push(line);
    cursor += 1;
    if (line.includes(closingDelimiter)) break;
  }

  return {
    latex: mathLines.join('\n').trim(),
    nextIndex: cursor,
    collapseEscapedBackslashes,
  };
}

export function renderTerminalMath(latex: string, options: RenderTerminalMathOptions = {}): string {
  const normalizedLatex = normalizeLatexInput(latex, options.collapseEscapedBackslashes ?? false);
  if (!normalizedLatex) return '';

  try {
    return normalizeRenderedMath(renderMathNodes(parseMath(normalizedLatex)));
  } catch {
    return renderTerminalMathFallback(normalizedLatex);
  }
}

function normalizeLatexInput(latex: string, forceCollapseEscapedBackslashes: boolean): string {
  let normalized = latex.trim();
  if (forceCollapseEscapedBackslashes || looksDoubleEscapedLatex(normalized)) {
    normalized = collapseEscapedBackslashes(normalized);
  }
  return normalized;
}

function looksDoubleEscapedLatex(value: string): boolean {
  const doubledCommands = value.match(/\\\\[A-Za-z]/g)?.length ?? 0;
  const singleCommands = value.match(/(^|[^\\])\\[A-Za-z]/g)?.length ?? 0;
  return doubledCommands > 0 && singleCommands === 0;
}

function collapseEscapedBackslashes(value: string): string {
  return value.replace(/\\{2,}/g, (slashes) => '\\'.repeat(Math.ceil(slashes.length / 2)));
}

function renderMathNodes(nodes: LatexNode[]): string {
  let rendered = '';
  let index = 0;

  while (index < nodes.length) {
    const node = nodes[index]!;
    if (node.type === 'macro' && isUnknownMacro(node)) {
      const followingGroups: Array<Extract<LatexNode, { type: 'group' }>> = [];
      let cursor = index + 1;
      while (nodes[cursor]?.type === 'group') {
        followingGroups.push(nodes[cursor] as Extract<LatexNode, { type: 'group' }>);
        cursor += 1;
      }
      if (followingGroups.length > 0) {
        rendered += `${renderMacro(node)}${followingGroups.map((group) => `{${renderMathNodes(group.content)}}`).join('')}`;
        index = cursor;
        continue;
      }
    }

    rendered += renderMathNode(node);
    index += 1;
  }

  return rendered;
}

function renderMathNode(node: LatexNode): string {
  switch (node.type) {
    case 'root':
    case 'group':
    case 'environment':
    case 'mathenv':
    case 'inlinemath':
    case 'displaymath':
      return renderMathNodes(node.content);
    case 'string':
      return node.content === '&' ? '' : node.content;
    case 'whitespace':
      return ' ';
    case 'parbreak':
      return '\n';
    case 'comment':
      return '';
    case 'macro':
      return renderMacro(node);
    case 'verb':
    case 'verbatim':
      return node.content;
    default:
      return '';
  }
}

function renderMacro(node: LatexMacro): string {
  const name = node.content;
  const args = macroArgs(node);

  if (name === '\\') return '\n';
  if (name === '_' || name === '^') return `${name}${renderScriptArgument(args[0])}`;
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return renderFraction(args);
  if (name === 'sqrt') return renderSqrt(args);
  if (name === 'left' || name === 'right') return '';
  if (name === '!') return '';
  if (spacingMacros.has(name)) return ' ';
  if (passthroughMacros.has(name)) return args.map((arg) => renderArgument(arg)).join('');

  const replacement = latexMacroReplacements[name];
  if (replacement !== undefined) return replacement;

  return renderUnknownMacro(node, args);
}

function isUnknownMacro(node: LatexMacro): boolean {
  const name = node.content;
  return !(
    name === '\\' ||
    name === '_' ||
    name === '^' ||
    name === 'frac' ||
    name === 'dfrac' ||
    name === 'tfrac' ||
    name === 'sqrt' ||
    name === 'left' ||
    name === 'right' ||
    name === '!' ||
    spacingMacros.has(name) ||
    passthroughMacros.has(name) ||
    latexMacroReplacements[name] !== undefined
  );
}

function macroArgs(node: LatexMacro): LatexArgument[] {
  return Array.isArray(node.args) ? (node.args as LatexArgument[]) : [];
}

function renderArgument(argument: LatexArgument | undefined): string {
  return argument ? normalizeRenderedMath(renderMathNodes(argument.content)) : '';
}

function renderScriptArgument(argument: LatexArgument | undefined): string {
  const rendered = renderArgument(argument);
  return /[\s\n]/.test(rendered) ? `{${rendered}}` : rendered;
}

function renderFraction(args: LatexArgument[]): string {
  const numerator = renderArgument(args[0]);
  const denominator = renderArgument(args[1]);
  if (!numerator || !denominator) return '\\frac';
  return `(${numerator})/(${denominator})`;
}

function renderSqrt(args: LatexArgument[]): string {
  const radicand = [...args].reverse().find((arg) => arg.content.length > 0);
  const renderedRadicand = renderArgument(radicand);
  return renderedRadicand ? `\u221a(${renderedRadicand})` : '\u221a';
}

function renderUnknownMacro(node: LatexMacro, args: LatexArgument[]): string {
  const escapeToken = node.escapeToken ?? '\\';
  const renderedArgs = args
    .map((arg) => `${arg.openMark ?? '{'}${renderMathNodes(arg.content)}${arg.closeMark ?? '}'}`)
    .join('');
  return `${escapeToken}${node.content}${renderedArgs}`;
}

function normalizeRenderedMath(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\s*=\s*/g, ' = ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function renderTerminalMathFallback(latex: string): string {
  let rendered = latex.trim();
  if (!rendered) return '';

  rendered = rendered.replace(/\\begin\{[^}]+}/g, '').replace(/\\end\{[^}]+}/g, '');
  rendered = replaceLatexCommandWithBracedArgument(rendered, 'text', (value) => value);
  rendered = replaceLatexCommandWithBracedArgument(rendered, 'textrm', (value) => value);
  rendered = replaceLatexCommandWithBracedArgument(rendered, 'mathrm', (value) => value);
  rendered = replaceLatexCommandWithBracedArgument(rendered, 'mathbf', (value) => value);
  rendered = replaceLatexCommandWithBracedArgument(rendered, 'operatorname', (value) => value);
  rendered = replaceLatexFractions(rendered);
  rendered = rendered.replace(/\\left\b|\\right\b/g, '');

  for (const [command, replacement] of Object.entries(latexMacroReplacements)) {
    rendered = rendered.replace(new RegExp(`\\\\${escapeRegExp(command)}\\b`, 'g'), replacement);
  }

  return normalizeRenderedMath(
    rendered
      .replace(/&/g, '')
      .replace(/\\\\/g, '\n')
      .replace(/\\,/g, ' ')
      .replace(/\\;/g, ' ')
      .replace(/\\:/g, ' ')
      .replace(/\\!/g, '')
      .replace(/[{}]/g, ''),
  );
}

function replaceLatexFractions(value: string): string {
  let rendered = value;
  let cursor = 0;

  while (cursor < rendered.length) {
    const commandIndex = rendered.indexOf('\\frac', cursor);
    if (commandIndex === -1) break;

    const numerator = readBracedArgument(rendered, commandIndex + '\\frac'.length);
    if (!numerator) {
      cursor = commandIndex + '\\frac'.length;
      continue;
    }
    const denominator = readBracedArgument(rendered, numerator.endIndex);
    if (!denominator) {
      cursor = numerator.endIndex;
      continue;
    }

    const replacement = `(${renderTerminalMathFallback(numerator.value)})/(${renderTerminalMathFallback(denominator.value)})`;
    rendered = `${rendered.slice(0, commandIndex)}${replacement}${rendered.slice(denominator.endIndex)}`;
    cursor = commandIndex + replacement.length;
  }

  return rendered;
}

function replaceLatexCommandWithBracedArgument(
  value: string,
  command: string,
  format: (argument: string) => string,
): string {
  let rendered = value;
  let cursor = 0;
  const commandText = `\\${command}`;

  while (cursor < rendered.length) {
    const commandIndex = rendered.indexOf(commandText, cursor);
    if (commandIndex === -1) break;

    const argument = readBracedArgument(rendered, commandIndex + commandText.length);
    if (!argument) {
      cursor = commandIndex + commandText.length;
      continue;
    }

    const replacement = format(renderTerminalMathFallback(argument.value));
    rendered = `${rendered.slice(0, commandIndex)}${replacement}${rendered.slice(argument.endIndex)}`;
    cursor = commandIndex + replacement.length;
  }

  return rendered;
}

function readBracedArgument(value: string, fromIndex: number): { value: string; endIndex: number } | null {
  let cursor = fromIndex;
  while (cursor < value.length && /\s/.test(value[cursor] ?? '')) cursor += 1;
  if (value[cursor] !== '{') return null;

  let depth = 0;
  for (let index = cursor; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { value: value.slice(cursor + 1, index), endIndex: index + 1 };
      }
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
