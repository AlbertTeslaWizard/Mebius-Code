import { describe, expect, it } from 'bun:test';
import { preprocessMarkdownMath, renderTerminalMath } from '../src/app/markdownMath';

describe('TUI markdown math preprocessing', () => {
  it('renders bracket display math as terminal-readable text', () => {
    const markdown = [
      'The work formula is:',
      '\\[',
      'W = F \\cdot d \\cdot \\cos\\theta',
      '\\]',
      'Where:',
    ].join('\n');

    expect(preprocessMarkdownMath(markdown)).toBe(['The work formula is:', 'W = F \u00b7 d \u00b7 cos\u03b8', 'Where:'].join('\n'));
  });

  it('renders double-escaped bracket display math from markdown output', () => {
    const markdown = ['\\\\[', 'W = F \\\\cdot d \\\\cdot \\\\cos\\\\theta', '\\\\]'].join('\n');

    expect(preprocessMarkdownMath(markdown)).toBe('W = F \u00b7 d \u00b7 cos\u03b8');
  });

  it('renders dollar display math and common LaTeX commands', () => {
    const markdown = [
      '$$',
      'W_{\\text{net}} = \\Delta KE = \\frac{1}{2}mv_f^2 - \\frac{1}{2}mv_i^2',
      '$$',
    ].join('\n');

    expect(preprocessMarkdownMath(markdown)).toBe('W_net = \u0394 KE = (1)/(2)mv_f^2 - (1)/(2)mv_i^2');
  });

  it('renders inline bracket math conservatively', () => {
    expect(preprocessMarkdownMath('Use \\(F \\cdot d\\) for work.')).toBe('Use F \u00b7 d for work.');
  });

  it('renders double-escaped inline bracket math', () => {
    expect(preprocessMarkdownMath('Use \\\\(F \\\\cdot d\\\\) for work.')).toBe('Use F \u00b7 d for work.');
  });

  it('renders obvious inline dollar math without converting prices', () => {
    expect(preprocessMarkdownMath('Cost is $5, equation is $E = mc^2$.')).toBe('Cost is $5, equation is E = mc^2.');
  });

  it('does not convert math delimiters inside fenced code blocks', () => {
    const markdown = ['```md', '\\\\[', 'W = F \\\\cdot d', '\\\\]', '```'].join('\n');

    expect(preprocessMarkdownMath(markdown)).toBe(markdown);
  });

  it('renders LaTeX environments as readable multiline math', () => {
    const markdown = ['\\begin{aligned}', 'a &= b \\\\', 'c &= \\Delta d', '\\end{aligned}'].join('\n');

    expect(preprocessMarkdownMath(markdown)).toBe('a = b\nc = \u0394 d');
  });

  it('renders terminal math directly for nested fractions', () => {
    expect(renderTerminalMath('\\frac{\\Delta x}{\\frac{1}{2}t}')).toBe('(\u0394 x)/((1)/(2)t)');
  });

  it('preserves unknown macros instead of dropping content', () => {
    expect(renderTerminalMath('\\unknown{x}')).toBe('\\unknown{x}');
  });
});
