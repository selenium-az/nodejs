const fs = require('fs');
const unzip = require('unzip');

console.log('Unzipping browser profile ...');

const SELENIUM_BROWSER_PROFILE_PATH = `${__dirname}/browser_profiles/${process.env.SELENIUM_BROWSER}/alitalia.selenium`;

fs.createReadStream(`${SELENIUM_BROWSER_PROFILE_PATH}.zip`)
    .pipe(unzip.Extract({ path: SELENIUM_BROWSER_PROFILE_PATH }));
