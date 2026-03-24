const fs = require('fs');
const content = fs.readFileSync('.Jules/palette.md', 'utf8');

const newEntry = `## 2026-03-20 - [WPF TextBox Watermark Accessibility]

**Learning:** In WPF interfaces, when layering a \`TextBlock\` over a \`TextBox\` to simulate a missing placeholder property, explicitly setting \`AutomationProperties.Name=""\` on the watermark is an anti-pattern. It improperly obscures the element from screen readers.
**Action:** Omit the \`AutomationProperties.Name\` property entirely on overlay watermarks to allow screen readers to fall back to the \`Text\` property naturally.

`;

fs.writeFileSync('.Jules/palette.md', newEntry + content);
