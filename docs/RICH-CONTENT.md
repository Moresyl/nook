# 内容阅读

Nook 将模型回复中的 Markdown、表格、公式、代码和 Mermaid 图表显示在对话中，同时保留原始文本。

| 内容 | 阅读方式 |
| --- | --- |
| 公式 | 支持行内公式、独立公式及 `math`／`latex` 代码块；同时提供 MathML |
| 代码 | 语法高亮、复制原文、按块切换自动换行；未知语言显示为普通文本 |
| 图表 | 在只读图表与完整源码之间切换；绘制失败时保留源码和错误状态 |
| 宽内容 | 表格、公式与代码保留横向滚动，长代码随对话自然展开，适配窄窗口 |

## 代码阅读控制

代码块提供“代码自动换行”开关，可用鼠标、空格或 Enter 切换；图表切到源码后也可使用。换行只改变当前代码块的显示方式，不修改保存的原文、缩进、空行或复制内容，重新打开页面恢复默认横向滚动。窄窗口中的长语言名称会省略显示，操作按钮保留可用空间。

长代码随聊天自然展开，无需在代码块内部再次纵向滚动。普通代码与图表源码采用从左到右排版，保留混合语言原文；标题提供代码图标、换行和复制操作。图表的只读绘图仍保留自己的高度与滚动边界。

本轮原生富文本 16 项及完整源码桌面 406 项检查通过，浅色 100%／深色 150% 窄窗口中的最终代码行可达，两张末尾原图已核对。代码复制使用测试拦截，不等同物理剪贴板验收；当前分发与安装状态见[发布记录](RELEASE.md)。[长代码专项](../verification/code-flow-validation-review-result.json) · [完整源码](../verification/code-flow-full-source-review-result.json)

早期换行实现的 13 项相关测试、两轮实际桌面内容专项及[浅色](images/code-wrap-light.png)／[深色窄窗](images/code-wrap-dark-narrow.png)原图继续保留，只证明当时的实现。[早期记录](../verification/code-wrap-review-result.json)

## 范围与限制

图表仅供阅读，不执行其中的交互脚本或外部链接。图表源码上限为 50,000 字符，配置的边数上限为 500；超限或无法绘制时仍保留完整源码。此内容视图尚不包含代码执行、产物编辑或原始文档版式查看；项目终端与 HTML 预览见[项目说明](PROJECTS.md)。

数学字体随应用分发，无需 CDN。字体、样式和渲染库分别保留其许可证、版权及必要的保留名称，见[第三方许可](LICENSES.md)。

## 实现与验证记录

下文保留早期实现及验证细节。覆盖率数字只属于当时纳入统计的模块，不代表整个界面或第三方渲染器；当前版本状态见[发布记录](RELEASE.md)。

Assistant replies retain their original Markdown source in the workspace and exports. The renderer supports GFM tables, inline `$...$` formulas, display `$$...$$` formulas and fenced `math`/`latex` formulas. KaTeX produces accessible MathML alongside the visual formula. Trusted HTML/URL commands are disabled; macro expansion and requested sizes are bounded, and invalid formulas remain visible rather than executing HTML or loading remote images.

Fenced code uses the complete lowlight language catalog, including PowerShell. Language detection is disabled, and unknown languages remain readable as plain text. The supplied light/dark syntax colors are mapped to token classes; code headers offer exact source copying, retaining intentional final newlines. HTML-looking code stays escaped text. Inline code retains the existing typography.

Mermaid fences offer a readonly diagram and a source toggle with the same copy control. Rendering is lazy, serialized across diagrams and themes, and canceled results are discarded. While a streamed diagram is incomplete, its current source remains available. Empty/binary input, more than 50,000 characters, malformed diagrams and rendering failures show the complete source with a short status message. The configured graph edge limit is 500. A failure does not prevent later diagrams from rendering.

The Mermaid policy locks strict security, non-HTML labels, rendering limits, the classic appearance and the workspace palette/font. SVG output passes through DOMPurify with SVG/filter profiles; links, external image/use elements, foreign objects, executable markup and href/src attributes are removed. Standard SVG geometry/path attributes must remain intact. The diagram displays in an iframe with no script permission or desktop preload, and a separate CSP disables scripts, images, navigation bases and form actions. Same-origin permission allows local fonts and parent measurement. The diagram never installs Mermaid's interactive callbacks. Larger diagrams have bounded frame height and local scrolling; no browser or interactive artifact surface is provided by this feature.

The supplied math CSS rules and font faces are retained locally. Fifty-nine supplied external font files and the complete Size3 WOFF2 font extracted from the supplied CSS match KaTeX 0.16.45 byte for byte. Size3 WOFF2 uses a local file with Vite's no-inline option so the existing self-only font policy remains applicable; its WOFF/TTF fallbacks remain local. The asset inventory pins all 60 font files and the complete stylesheet hash. Package verification checks renderer fonts and module fallbacks. All 60 font name tables declare OFL 1.1; their original copyright/RFN declarations and the full official OFL text are retained, alongside the library/styles' separate MIT license. Font loading requires no CDN. OpenAI Sans's separate unresolved redistribution rights still apply to the general interface font.

Verification covers formula modes and malformed/unsafe commands, known/unknown languages, exact AST source extraction, size bounds, locked palettes, renderer serialization/cancellation and failure cleanup. The new render helpers reach 100% lines/functions/branches; the separately covered license collector reaches 100% lines/functions and 97.18% branches. These metrics exclude React UI, IPC and the actual third-party renderer internals.

The real Electron checks stream a reply from an isolated local provider, inspect loaded formula fonts/MathML and reference token colors, copy exact code/diagram source, and verify flowchart/sequence/class SVG output. They inspect viewBox, edge paths and distinct node positions, exercise light/dark/minimum-window rendering, retain a manually chosen scroll position during theme/layout changes, reject hostile directives/HTML/remote math commands, and recover after malformed and oversized diagrams. Clipboard writes use a test-process renderer fixture to preserve the user's system clipboard. Additional source substitutions are persisted through the desktop bridge and reloaded. These payload checks do not establish an exhaustive audit of every Mermaid diagram type or source syntax.

Screenshots `33`–`37` record light formulas/code, dark formulas at the minimum window, complete oversized-source fallback, and the light/dark diagram surfaces. A screenshot check caught an overly restrictive URI rule that also removed SVG coordinates and path data; the final sanitizer blocks actual link/source attributes while preserving geometry. The native checks now assert those attributes explicitly. The supplied design's font summary had truncated the embedded Size3 declaration to 800 characters; its complete declaration was recovered from the supplied app-shared stylesheet, retaining the original font bytes. The embedded URL was blocked by the existing font CSP, so those original bytes now use a local asset. Native checks require all 20 parsed math faces and actual Size3 font loading for large delimiters. Inspecting the font name tables also corrected the initial package-level MIT classification to the font-specific OFL terms. An initial test-only animation-frame wait stalled in an offscreen iframe; readiness now waits for local fonts and reads layout directly, and the owned failed test process was terminated before rerunning.
