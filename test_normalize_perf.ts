
const str = "File100Component.ts";
const count = 10000;
const start = performance.now();
for (let i = 0; i < count; i++) {
    const normalized = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let bitflags = 0;
    for (let j = 0; j < normalized.length; j++) {
        const code = normalized.charCodeAt(j);
        // ... logic
    }
}
const end = performance.now();
console.log(`10k iterations: ${(end - start).toFixed(3)}ms`);
console.log(`Per call: ${((end - start)/count).toFixed(3)}ms`);
