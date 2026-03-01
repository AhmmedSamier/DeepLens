const templates = ['[GET] /api/users', ' [GET] /api', 'api/test', '[POST]/api', ' [POST] api ', '[123]/api'];

for (const template of templates) {
    const trimmed = template.trimStart();
    let startIdx = 0;
    if (trimmed.charCodeAt(0) === 91) { // '['
        const closeIdx = trimmed.indexOf(']');
        if (closeIdx > 0) {
            let isAllUpper = true;
            for (let i = 1; i < closeIdx; i++) {
                const code = trimmed.charCodeAt(i);
                if (code < 65 || code > 90) { // A-Z
                    isAllUpper = false;
                    break;
                }
            }
            if (isAllUpper && closeIdx > 1) { // Must have at least one char between []
                startIdx = closeIdx + 1;
                while (startIdx < trimmed.length && trimmed.charCodeAt(startIdx) === 32) { // space
                    startIdx++;
                }
            }
        }
    }
    const cleanTemplate = trimmed.slice(startIdx).trim();
    console.log(`'${template}' -> '${cleanTemplate}'`);
}
