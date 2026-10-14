import { tableSource } from './prose-layout-fixture.mjs';

export const richReply = [
  '# RICH_CONTENT_EVIDENCE',
  '行内公式 $x^2 + y^2 = z^2$。',
  '', '$$', '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}', '$$',
  '', '```math', '\\mathcal{F} + \\mathfrak{g} + \\sqrt{2} + \\biggl(\\frac{a}{b}\\biggr)', '```',
  '', '```javascript', 'const note = "<img src=x onerror=window.qiyaoAttack=true>";', '// 保留 UTF-8 注释', 'console.log(note);', '```',
  '', '```powershell', 'Write-Output "POWERSHELL_HIGHLIGHT_EVIDENCE"', '```',
  '', '```unknown-language', 'KEEP_UNKNOWN_SOURCE', '```',
  '', '```mermaid', 'flowchart LR', 'A[编写代码] --> B[运行测试]', 'B --> C[完成]', '```',
  '', '## 表格原文', '', tableSource, '', '尾部 RICH_CONTENT_END'
].join('\n');
