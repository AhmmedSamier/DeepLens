const { performance } = require('perf_hooks');

const templates = [
  '/api/users.json',
  '/api/items+extras',
  '/api/settings$id'
];

function stringApproach(cleanTemplate) {
    let pattern = '';
    let hasCatchAll = false;
    let i = 0;
    const len = cleanTemplate.length;

    while (i < len) {
        const char = cleanTemplate[i];

        if (char === '{') {
            const closeIdx = cleanTemplate.indexOf('}', i + 1);
            if (closeIdx !== -1) {
                const paramContent = cleanTemplate.slice(i + 1, closeIdx);
                if (paramContent.startsWith('*')) {
                    hasCatchAll = true;
                    pattern += '(.*)';
                } else {
                    pattern += '([^/]+)';
                }
                i = closeIdx + 1;
                continue;
            }
        }

        // Escape regex specials
        if ('.*+?^${}()|[]\\'.includes(char)) {
            pattern += '\\' + char;
        } else {
            pattern += char;
        }
        i++;
    }

    return { pattern, hasCatchAll };
}


for(let temp of templates) {
    let pattern = temp;
    pattern = pattern.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    console.log(pattern, " == ", stringApproach(temp).pattern);
}
