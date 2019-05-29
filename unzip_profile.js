const fs = require('fs');
const unzip = require('unzip');

console.log('Unzipping browser profile ...');

fs.createReadStream(`${process.env.SELENIUM_BROWSER_PROFILE_PATH}.zip`)
    .pipe(unzip.Extract({ path: process.env.SELENIUM_BROWSER_PROFILE_PATH }));
