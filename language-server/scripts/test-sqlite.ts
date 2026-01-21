import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const dbPath = path.join(process.cwd(), 'test.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

try {
    console.log('Opening database...');
    const db = new Database(dbPath);

    console.log('Creating table...');
    db.exec(`
        CREATE TABLE files (
            path TEXT PRIMARY KEY,
            mtime INTEGER,
            hash TEXT,
            symbols TEXT
        )
    `);

    console.log('Inserting data...');
    const stmt = db.prepare('INSERT INTO files (path, mtime, hash, symbols) VALUES (?, ?, ?, ?)');
    stmt.run('/test/path', 123456789, 'abc123hash', JSON.stringify([{ name: 'testSymbol' }]));

    console.log('Querying data...');
    const row = db.prepare('SELECT * FROM files WHERE path = ?').get('/test/path');

    console.log('Result:', row);

    db.close();
    console.log('Success!');
} catch (error) {
    console.error('SQLite test failed:', error);
    process.exit(1);
} finally {
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
    }
}
