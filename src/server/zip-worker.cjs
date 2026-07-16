const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const dirPath = process.argv[2];
const zipPath = process.argv[3];

const output = fs.createWriteStream(zipPath);
const archive = new ZipArchive({ zlib: { level: 0 } });

output.on('close', () => process.exit(0));
archive.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

archive.pipe(output);

const items = fs.readdirSync(dirPath);
for (const item of items) {
  const itemPath = path.join(dirPath, item);
  const stat = fs.statSync(itemPath);
  
  if (stat.isDirectory()) {
    // Preserve Windows ReadOnly folder attribute (0x11) which survives extraction better than System (0x14)
    archive.append(null, { name: item + '/', dosPermissions: 0x11 });
    
    const files = fs.readdirSync(itemPath);
    for (const file of files) {
      const filePath = path.join(itemPath, file);
      let dosPerms = 0x20; // Default Archive
      
      // Hide system/icon files
      if (file === 'desktop.ini' || file === 'album.ico' || file === 'folder.jpg' || file === 'AlbumArtSmall.jpg') {
        dosPerms = 0x22; // Hidden + Archive
      }
      
      archive.file(filePath, { name: item + '/' + file, dosPermissions: dosPerms });
    }
  } else {
    archive.file(itemPath, { name: item });
  }
}

archive.finalize();
