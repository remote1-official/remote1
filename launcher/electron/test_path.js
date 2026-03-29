const path = require('path');
console.log('__dirname:', __dirname);
const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
console.log('icoPath:', icoPath);
console.log('escaped:', icoPath.replace(/\/g, '\\'));
console.log('file exists:', require('fs').existsSync(icoPath));
