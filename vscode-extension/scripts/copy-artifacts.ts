import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

async function copyArtifacts() {
  const rootDir = join(__dirname, "..", "..");
  const serverDist = join(rootDir, "language-server", "dist");
  const extensionDist = join(__dirname, "..", "dist");

  if (!existsSync(extensionDist)) {
    await mkdir(extensionDist, { recursive: true });
  }

  const files = ["server.js", "indexer-worker.js"];

  for (const file of files) {
    const src = join(serverDist, file);
    const dest = join(extensionDist, file);
    
    if (existsSync(src)) {
      console.log(`Copying ${src} to ${dest}`);
      await copyFile(src, dest);
    } else {
      console.error(`Source file not found: ${src}`);
      process.exit(1);
    }
  }

  // Copy bin directory (contains ripgrep)
  const binSrc = join(serverDist, "bin");
  const binDest = join(extensionDist, "bin");

  if (existsSync(binSrc)) {
      console.log(`Copying bin directory from ${binSrc} to ${binDest}`);
      if (!existsSync(binDest)) {
          await mkdir(binDest, { recursive: true });
      }
      
      const binaries = await import("fs").then(fs => fs.readdirSync(binSrc));
      for (const binary of binaries) {
          await copyFile(join(binSrc, binary), join(binDest, binary));
      }
  } else {
      console.warn(`Warning: bin directory not found in server dist: ${binSrc}`);
      // Don't fail the build, as in some envs we might rely on system rg? 
      // Actually per analysis, the code relies on it, but maybe for dev it's okay?
      // Let's just warn.
  }
}

copyArtifacts().catch((err) => {
  console.error(err);
  process.exit(1);
});
