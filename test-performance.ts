function runSetAddDelete() {
    let s = new Set<number>();
    const start = performance.now();
    for (let i = 0; i < 10000; i++) s.add(i);
    for (let i = 0; i < 10000; i++) s.delete(i);
    const end = performance.now();
    console.log(`Set add+delete 10000 items: ${end - start} ms`);
}
function runSetAddLoopDelete() {
    let s = new Set<number>();
    const start = performance.now();
    for (let i = 0; i < 10000; i++) s.add(i);
    let arr = [];
    for (let x of s) arr.push(x);
    for (let i = 0; i < 10000; i++) s.delete(i);
    const end = performance.now();
    console.log(`Set add+loop+delete 10000 items: ${end - start} ms`);
}
runSetAddDelete();
runSetAddLoopDelete();
