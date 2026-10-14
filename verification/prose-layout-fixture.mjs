export const tableSource = ['| Left | Center | Right | Long identifier |', '| :--- | :---: | ---: | --- |', '| **汉字** | 😀 | 42 | PROSE_TABLE_EXACT_' + 'identifier_'.repeat(25) + ' |', '| second | center | 99 | retained |'].join('\r\n');
export const proseReply = [
  '中文第一段，保留 **强调中的汉字** 与 emoji 😀。', '', '中文第二段，保留 [链接中的文字](https://example.invalid/)。', '',
  'English **cross** node match with literal punctuation [a.*].', '',
  '# 一级标题', '', '标题后的正文。', '', '## 二级标题', '', '### 三级标题', '', '#### 四级标题', '', '##### 五级标题', '', '###### 六级标题', '',
  '- 父级列表', '  - 第二级列表', '    - 第三级列表', '- 后续条目', '', '1. 顺序列表', '2. 后续顺序列表', '', '- [x] 已完成', '- [ ] 未完成', '',
  '> 引用保留中文与 English。', '>', '> 第二段引用。', '', '---', '', tableSource, '', 'PROSE_LAYOUT_END，保存原文不变。',
].join('\n');
