const { performance } = require('perf_hooks');

const templates = [
  '/api/users/{*slug}',
  '/api/items/{id:int}/{name}',
  '/api/settings/{id?}',
  '/api/resources/{id}/delete',
  'api/no/params'
];

const ITERS = 100000;

function regexApproach(cleanTemplate) {
    let pattern = cleanTemplate;
    const hasCatchAll = pattern.includes('{*');
    pattern = pattern.replaceAll(/\{(\*\w+)\}/g, '___CATCHALL___');
    pattern = pattern.replaceAll(/\{[\w?]+(?::\w+)?\}/g, '___PARAM___');
    pattern = pattern.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    pattern = pattern.replaceAll('___PARAM___', '([^/]+)');
    pattern = pattern.replaceAll('___CATCHALL___', '(.*)');
    return { pattern, hasCatchAll };
}

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
                if (paramContent.charCodeAt(0) === 42) { // '*'
                    hasCatchAll = true;
                    pattern += '(.*)';
                } else {
                    pattern += '([^/]+)';
                }
                i = closeIdx + 1;
                continue;
            }
        }

        const code = cleanTemplate.charCodeAt(i);
        // Escape regex specials: .*+?^${}()|[]\
        if (
            code === 46 || // .
            code === 42 || // *
            code === 43 || // +
            code === 63 || // ?
            code === 94 || // ^
            code === 36 || // $
            code === 123 || // {
            code === 125 || // }
            code === 40 || // (
            code === 41 || // )
            code === 124 || // |
            code === 91 || // [
            code === 93 || // ]
            code === 92    // \
        ) {
            pattern += '\\' + char;
        } else {
            pattern += char;
        }
        i++;
    }

    return { pattern, hasCatchAll };
}

// Warmup
for (let i = 0; i < 1000; i++) {
    regexApproach(templates[i % templates.length]);
    stringApproach(templates[i % templates.length]);
}

const startRegex = performance.now();
for (let i = 0; i < ITERS; i++) {
    regexApproach(templates[i % templates.length]);
}
const endRegex = performance.now();

const startString = performance.now();
for (let i = 0; i < ITERS; i++) {
    stringApproach(templates[i % templates.length]);
}
const endString = performance.now();

console.log(`Regex approach: ${(endRegex - startRegex).toFixed(2)} ms`);
console.log(`String approach: ${(endString - startString).toFixed(2)} ms`);
console.log(`Speedup: ${((endRegex - startRegex) / (endString - startString)).toFixed(2)}x`);

for(let temp of templates) {
    console.log(regexApproach(temp).pattern, " == ", stringApproach(temp).pattern);
}
