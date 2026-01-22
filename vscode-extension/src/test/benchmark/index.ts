import { glob } from 'glob';
import Mocha from 'mocha';
import * as path from 'path';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 60000, // Long timeout for benchmarks
    });

    const testsRoot = __dirname;

    return new Promise(async (resolve, reject) => {
        try {
            const files = await glob('**/**.bench.test.js', { cwd: testsRoot });

            // Add files to the test suite
            files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.run((failures) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                console.error(err);
                reject(err);
            }
        } catch (err) {
            return reject(err);
        }
    });
}
