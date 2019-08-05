const { Builder, By, logging, until, Actions } = require('selenium-webdriver');
const { getOtp } = require('./otp-helper');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const moment = require('moment');
const camelcase = require('camelcase');
const dotenv = require('dotenv');

const firefox = require('selenium-webdriver/firefox');
const chrome = require('selenium-webdriver/chrome');

const argv = require('yargs')
  .string('st')
  .alias('st', 'select-test')
  .describe('st', 'Executes only selected test(s) from test suite.')
  .boolean('gc')
  .default('gc', false)
  .alias('gc', 'generate-commands')
  .describe('gc', 'Generates JSON file of "Selenium" commands.')
  .boolean('gco')
  .default('gco', false)
  .alias('gco', 'generate-commands-only')
  .describe('gco', 'Generates JSON file of "Selenium" commands but does not execute them.')
  .boolean('cs')
  .default('cs', true)
  .alias('cs', 'capture-screen')
  .describe('cs', 'Generates screen captures after each step.')
  .help('help')
  .argv;

dotenv.config();

const SELENIUM_COMMAND_TIMEOUT = (process.env.SELENIUM_COMMAND_TIMEOUT ? parseInt(process.env.SELENIUM_COMMAND_TIMEOUT) : 60) * 1000;

const SELENIUM_LOG_LEVEL = process.env.SELENIUM_LOG_LEVEL === 'DEBUG' ? logging.Level.ALL : logging.Level.INFO;

var SELENIUM_TEST_DATA = typeof process.env.SELENIUM_TEST_DATA === 'string' ? process.env.SELENIUM_TEST_DATA : './test_data/test_suite.json';

var SELENIUM_TARGET_URL = process.env.SELENIUM_TARGET_URL;

var SELENIUM_WINDOW_SIZE = typeof process.env.SELENIUM_WINDOW_SIZE === 'string' ? process.env.SELENIUM_WINDOW_SIZE : '1280x720';

var SELENIUM_SESSION_VARS = {};
var SELENIUM_TEST_VARS = {};

logging.installConsoleHandler();
logging.getLogger('webdriver.http').setLevel(SELENIUM_LOG_LEVEL);

_mkdirSync(`./browser_captures`);
_mkdirSync(`./browser_captures/${process.env.SELENIUM_BROWSER}`);

(async function RunTestSuite() {

  let test_suite = JSON.parse(fs.readFileSync(SELENIUM_TEST_DATA, 'utf8'));

  if (test_suite.tests === undefined || test_suite.tests.length === 0) {
    console.log('Unable to run tests. Test suite is empty!');
    return;
  }

  let test_selected = test_suite.tests;
  if (argv.st) {
    test_selected = test_selected.filter(function (t) {
      return ` ${argv.st} `.match(` ${t.name} `) !== null;
    });
    if (test_selected.length === 0) {
      console.log('Unable to run tests. Selected test(s) not found!');
      return;
    }
    console.log(`Running '${argv.st}' test(s) ...`);
  } else {
    console.log(`Running '${test_suite.name}' test suite ...`);
  }

  if (SELENIUM_TARGET_URL === undefined) {
    SELENIUM_TARGET_URL = test_suite.url;
  }

  test_suite.start = moment();

  await writeTestSuiteResultsHeader(test_suite);

  for (let i = 0; i < test_selected.length; i++) {
    await RunTest(test_selected[i], test_suite);
    await writeTestResults(test_selected[i], test_suite);
  }

  if (argv.gc || argv.gco) {
    if (argv.gco) {
      for (let i = 0; i < test_selected.length; i++) {
        test_selected[i].data = null;
      }
    }
    saveCommands(test_suite, `./test_data/${test_suite.name}_${test_suite.start.format('YYYYMMDDHHmmSS')}.json`);
  }

  function saveCommands(data, path) {
    try {
      fs.writeFileSync(path, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(err);
    }
  }

  async function writeTestSuiteResultsHeader(testSuite) {
    _mkdirSync(`./browser_captures/${process.env.SELENIUM_BROWSER}/${testSuite.start.format('YYYYMMDDHHmmSS')}`);
    let resultFile = `./browser_captures/${process.env.SELENIUM_BROWSER}/${testSuite.start.format('YYYYMMDDHHmmSS')}/testResults.csv`;
    //fs.writeFileSync(resultFile, `testName;result;pnr;error\r\n`);
    fs.writeFileSync(resultFile, `TEST_ID;TEST_NAME;FROM;TO;FLIGHT;DEPARTURE_DATE;RETURN_DATE;CLASS;ADULT;CHILD;INFANT;RESULT;PNR;ERROR\r\n`);
  }

  async function writeTestResults(test, testSuite) {
    let resultFile = `./browser_captures/${process.env.SELENIUM_BROWSER}/${testSuite.start.format('YYYYMMDDHHmmSS')}/testResults.csv`;
    //fs.appendFileSync(resultFile, `${test.name};${SELENIUM_TEST_VARS['_resultStatus'] || ''};${SELENIUM_TEST_VARS['_pnr'] || ''};${SELENIUM_TEST_VARS['_resultMessage'] || ''}\r\n`);
    let resultRow = `${test.name};${test.description}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_from'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_to'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_travelType'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_departureDate'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_returnDate'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_class'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_adults'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_childs'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_infants'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_resultStatus'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_pnr'] || ''}`;
    resultRow = `${resultRow};${SELENIUM_TEST_VARS['_resultMessage'] || ''}`;
    fs.appendFileSync(resultFile, `${resultRow}\r\n`);
  }

})();

async function RunTest(test, testSuite) {
  let driver;

  let suiteStart = testSuite.start;

  let cmdStart = null;
  let cmdComplete = null;

  SELENIUM_TEST_VARS = {};

  if (test.commands && test.commands.length > 0) {
    await runTestCommands(test);
    return;
  }

  if (argv.gc || argv.gco) {
    test.commands = [];
  }

  try {

    await _echo({
      target: `Starting '${test.name}' test ...`
    });

    await startSearch();

    await setTravelType(test.data.inbound == null);

    if (test.data.outbound) {
      await setOutboundData();
    }

    if (test.data.inbound) {
      await setInboundData();
    }

    await fulfillTravelOptions();

    await _captureEntirePageScreenshot({
      target: 'travel_options',
      successMessage: 'Captured travel options page.'
    });

    await runSearch(driver, test.data);

    SELENIUM_TEST_VARS["_resultStatus"] = "OK";

    await _close({});

  } catch (err) {

    SELENIUM_TEST_VARS["_resultStatus"] = "KO";
    SELENIUM_TEST_VARS["_resultMessage"] = err.message;

    console.log(`Error occurred: ${err.message}`);

    if (driver) {
      await capturePage('error');
      await driver.quit();
      capturesToPdf(test.data);
    }
  }

  function setTestVars(name, value) {
    SELENIUM_TEST_VARS[name] = value;
    SELENIUM_SESSION_VARS[name] = value;
  }

  async function capturePage(captureTitle) {
    await driver.sleep(2000);
    await driver.takeScreenshot().then(
      function (image, err) {
        _mkdirSync(`./browser_captures/${process.env.SELENIUM_BROWSER}/${suiteStart.format('YYYYMMDDHHmmSS')}`);
        let captureDir = `./browser_captures/${process.env.SELENIUM_BROWSER}/${suiteStart.format('YYYYMMDDHHmmSS')}/${test.name}`;
        _mkdirSync(captureDir);
        let captureCount = fs.readdirSync(captureDir).length + 1;
        let captureFile = `${captureDir}/${captureCount.toLocaleString(undefined, { minimumIntegerDigits: 2 })}_${captureTitle}.png`;
        fs.writeFileSync(captureFile, image, 'base64');
      }
    );
  }

  function notifyCommandStart(cmd) {
    cmdStart = moment.utc().format('YYYY-MM-DD HH:mm:ss');
    if (cmd && cmd.command === 'click') {
      console.log(`[${cmdStart}] ${cmd.target}`)
    }
  }

  function notifyCommandComplete(cmd) {
    cmdComplete = moment.utc().format('YYYY-MM-DD HH:mm:ss');
  }

  function capturesToPdf(data) {

    if (argv.cs === false) {
      return;
    }

    _mkdirSync(`./browser_captures/${process.env.SELENIUM_BROWSER}/${suiteStart.format('YYYYMMDDHHmmSS')}`);
    let captures_folder = `./browser_captures/${process.env.SELENIUM_BROWSER}/${suiteStart.format('YYYYMMDDHHmmSS')}/${test.name}`;
    _mkdirSync(captures_folder);

    fs.readdir(captures_folder, function (err, files) {
      if (files == 'undefined' || files.length == 0) {
        return;
      }
      let doc = new PDFDocument;

      doc.pipe(fs.createWriteStream(`${captures_folder}/${test.name}.pdf`));

      for (let i = 0; i < files.length; i++) {

        doc.addPage({ layout: "landscape" });

        doc.image(`${captures_folder}/${files[i]}`, {
          fit: [697, 451],
          align: 'center',
          valign: 'center'
        });
      }

      doc.end();
    });
  }

  async function checkSession() {

    if (argv.gco) {
      return;
    }

    if (driver) {
      return;
    }

    const SELENIUM_BROWSER_PROFILE_PATH = `${__dirname}/browser_profiles/${process.env.SELENIUM_BROWSER}/alitalia.selenium`;
    const SELENIUM_HEADLESS = process.env.SELENIUM_HEADLESS === undefined || process.env.SELENIUM_HEADLESS === 'true' ? true : false;
    const ENABLE_VERBOSE_LOGGING = SELENIUM_LOG_LEVEL === logging.Level.DEBUG || SELENIUM_LOG_LEVEL === logging.Level.ALL;

    let firefoxOptions = new firefox.Options()
      .setProfile(SELENIUM_BROWSER_PROFILE_PATH);

    let chromeOptions = new chrome.Options()
      .addArguments(`user-data-dir=${SELENIUM_BROWSER_PROFILE_PATH}`)
      .addArguments(`user-agent=${process.env.SELENIUM_BROWSER_USER_AGENT}`);

    if (SELENIUM_HEADLESS) {
      firefoxOptions.headless();
      chromeOptions.headless();
    }

    driver = await new Builder()
      .withCapabilities({
        'browserName': 'firefox',
        'acceptInsecureCerts': true
      })
      .setFirefoxService(new firefox.ServiceBuilder()
        .enableVerboseLogging(ENABLE_VERBOSE_LOGGING)
        .setStdio('inherit'))
      .setFirefoxOptions(firefoxOptions)
      .setChromeService(new chrome.ServiceBuilder()
        .enableVerboseLogging(ENABLE_VERBOSE_LOGGING)
        .setStdio('inherit'))
      .setChromeOptions(chromeOptions)
      .build();
  }

  async function startSearch() {

    await _open({
      target: '',
      successMessage: 'Alitalia Home Page showed.'
    });

    await _setWindowSize({
      target: SELENIUM_WINDOW_SIZE
    });

    await _runScript({
      target: 'document.querySelector(".cookie-bar a.closeCookie").click();',
      successMessage: 'Cookie bar closed.'
    });

    await _echo({
      target: 'Wait for booking flight widget ...'
    });

    await _waitForElementPresent({
      target: 'xpath=//*[@class="cerca-volo"]',
      successMessage: 'Booking flight widget found.'
    });

    await _captureEntirePageScreenshot({
      target: 'start_page',
      successMessage: 'Captured starting page.'
    });

  }

  async function setTravelType(oneWay) {

    /**
     * Multitratta
     * URL: /booking/homepage-multitratta.html
     * Locator: //*[@class="cerca-volo"]//*[contains(@class,"multitratta")]/a
     */

    await _echo({
      target: 'Selecting travel type ...'
    });

    await _click({
      target: oneWay ? 'css=fieldset > .input-wrap:nth-child(2) .placeholder' :
        'css=fieldset > .input-wrap:nth-child(3) .placeholder',
      successMessage: `${oneWay ? "One way" : "Round trip"} travel selected.`
    });

    SELENIUM_TEST_VARS['_travelType'] = `${oneWay ? "OneWay" : "RoundTrip"}`;

    if (argv.gco === false) {
      await driver.sleep(2000);
    }

  }

  async function setOutboundData() {
    await setDepartureCity(test.data.outbound);
    await setArrivalCity(test.data.outbound);
    await setOutboundDate(test.data.outbound.date, test.data.inbound == null);
  }

  async function setInboundData() {
    await setInboundDate(test.data.inbound.date);
  }

  async function fulfillTravelOptions() {

    await _echo({
      target: "Fulfilling travel options ..."
    });

    if (test.data.inbound == null) {

      await _waitForElementPresent({
        target: 'xpath=//*[@id="validate_date"]/button'
      });

      await _click({
        target: 'xpath=//*[@id="validate_date"]/button'
      });

    }

    await _waitForElementPresent({
      target: 'xpath=//*[@id="panel-travel-options" and contains(@style,"display: block")]',
      successMessage: 'Travel options panel displayed'
    });

    let passengers = test.data.passengers;
    let clickCount;

    clickCount = passengers.filter(function (p) {
      return p.type == "adult";
    }).length - 1;

    SELENIUM_TEST_VARS['_adults'] = clickCount + 1;

    if (clickCount > 0) {
      await _runScript({
        target: `var elm = document.getElementById("addAdults"); for (var i = 0; i < ${clickCount}; i++) { elm.click(); };`
      });
    }

    clickCount = passengers.filter(function (p) {
      return p.type == "child";
    }).length;

    SELENIUM_TEST_VARS['_childs'] = clickCount;

    if (clickCount > 0) {
      await _runScript({
        target: `var elm = document.getElementById("addKids"); for (var i = 0; i < ${clickCount}; i++) { elm.click(); };`
      });
    }

    clickCount = passengers.filter(function (p) {
      return p.type == "infant";
    }).length;

    SELENIUM_TEST_VARS['_infants'] = clickCount;

    if (clickCount > 0) {
      await _runScript({
        target: `var elm = document.getElementById("addBabies"); for (var i = 0; i < ${clickCount}; i++) { elm.click(); };`
      });
    }

  }

  async function runTestCommands(test) {
    for (let i = 0; i < test.commands.length; i++) {
      let cur_cmd = test.commands[i];
      switch (cur_cmd.command) {
        case 'assertLocation':
          await _assertLocation(cur_cmd);
          break;
        case 'assertNotLocation':
          await _assertNotLocation(cur_cmd);
          break;
        case 'captureEntirePageScreenshot':
          await _captureEntirePageScreenshot(cur_cmd);
          break;
        case 'click':
          await _click(cur_cmd);
          break;
        case 'close':
          await _close(cur_cmd);
          break;
        case 'echo':
          await _echo(cur_cmd);
          break;
        case 'mouseOver':
          await _mouseOver(cur_cmd);
          break;
        case 'open':
          await _open(cur_cmd);
          break;
        case 'otp':
          await _otp(cur_cmd);
          break;
        case 'runScript':
          await _runScript(cur_cmd);
          break;
        case 'select':
          await _select(cur_cmd);
          break;
        case 'setWindowSize':
          await _setWindowSize(cur_cmd);
          break;
        case 'store':
          await _store(cur_cmd);
          break;
        case 'storeAttribute':
          await _storeAttribute(cur_cmd);
          break;
        case 'storeText':
          await _storeText(cur_cmd);
          break;
        case 'type':
          await _type(cur_cmd);
          break;
        case 'verifyAttribute':
          await _verifyAttribute(cur_cmd);
          break;
        case 'verifyLocation':
          await _verifyLocation(cur_cmd);
          break;
        case 'waitForCondition':
          await _waitForCondition(cur_cmd);
          break;
        case 'waitForElementNotPresent':
          await _waitForElementNotPresent(cur_cmd);
          break;
        case 'waitForElementPresent':
          await _waitForElementPresent(cur_cmd);
          break;
        case 'waitForPageToLoad':
          await _waitForPageToLoad(cur_cmd);
          break;
        default:
          break;
      }
    }
  }

  function _by(target) {

    let m = target.match('^(xpath|css|id|name)=(.*)');
    if (m === null || m === undefined || m.length != 3) {
      return;
    }

    let by;
    switch (m[1]) {

      case 'id':
        by = By.id(m[2]);
        break;

      case 'name':
        by = By.name(m[2]);
        break;

      case 'css':
        by = By.css(m[2]);
        break;

      case 'xpath':
        by = By.xpath(m[2]);
        break;

      default:
        break;
    }

    return by;
  }

  async function _open(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'open',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      await checkSession();

      let url = require('url').resolve(SELENIUM_TARGET_URL, cmd.target);

      await driver.get(url)
        .then(function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _store(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'store',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      if (cmd.value.match(/^[_a-z][_a-z0-9]*$/i) == null) {
        throw `Store variable "${cmd.value}" is not valid.`;
      }
      setTestVars(cmd.value, cmd.target);
      if (cmd.successMessage) {
        console.log(cmd.successMessage);
      }
      notifyCommandComplete();
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _storeText(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'storeText',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      if (cmd.value.match(/^[_a-z][_a-z0-9]*$/i) == null) {
        throw `Store variable "${cmd.value}" is not valid.`;
      }
      by = _by(cmd.target);
      await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
        .then(async function (elm) {
          let elmText = await driver.executeScript(`return arguments[0].innerText;`, elm);
          setTestVars(cmd.value, elmText);
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _close(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'close',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    if (driver) {
      await driver.quit()
        .then(function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
        });
      driver = null;
      capturesToPdf(test.data);
    }
  }

  async function _verifyLocation(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'verifyLocation',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let u = await driver.getCurrentUrl();
      let m = u.match(cmd.target);
      if (m && m.length > 0) {
        if (cmd.successMessage) {
          console.log(cmd.successMessage);
        }
        notifyCommandComplete();
      }
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _assertLocation(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'assertLocation',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let u = await driver.getCurrentUrl();
      let m = u.match(cmd.target);
      if (m && m.length > 0) {
        if (cmd.successMessage) {
          console.log(cmd.successMessage);
        }
        notifyCommandComplete();
      } else {
        throw `Current URL does not match "${cmd.target}".`;
      }
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _assertNotLocation(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'assertNotLocation',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let u = await driver.getCurrentUrl();
      let m = u.match(cmd.target);
      if (m && m.length > 0) {
        throw `Current URL matches "${cmd.target}".`;
      } else {
        if (cmd.successMessage) {
          console.log(cmd.successMessage);
        }
        notifyCommandComplete();
      }
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _click(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'click',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart(cmd);
    try {
      by = _by(cmd.target);
      await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
        .then(async function (elm) {
          let value = 1;
          try { value = Number.parseFloat(cmd.value); } catch (error) { }
          if (!Number.isInteger(value) || value < 0) {
            value = 1;
          }
          for (let i = 0; i < value; i++) {
            await elm.click();
          }
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _waitForElementPresent(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'waitForElementPresent',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let by = _by(cmd.target);
      await driver.wait(until.elementLocated(by), cmd.value ? Number.parseInt(cmd.value) : SELENIUM_COMMAND_TIMEOUT)
        .then(async function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _waitForElementNotPresent(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'waitForElementNotPresent',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let by = _by(cmd.target);
      await driver.wait(until.elementIsNotVisible(driver.findElement(by)), cmd.value ? Number.parseInt(cmd.value) : SELENIUM_COMMAND_TIMEOUT)
        .then(async function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _waitForCondition(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'waitForCondition',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      await driver.wait(async function () {
        return await driver.executeScript(cmd.target);
      }, SELENIUM_COMMAND_TIMEOUT)
        .then(function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _otp(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'otp',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    let otp = '';
    let otpTime = moment.utc(cmdStart).subtract(1, 'seconds').format('YYYY-MM-DD HH:mm:ss');
    notifyCommandStart();
    try {
      let m = cmd.value.match(/^(mobile|email)=(.+)$/)
      if (m && m.length == 3) {
        let mobile = m[1] === 'mobile' ? m[2] : null;
        let email = m[1] === 'email' ? m[2] : null;
        let waitLimit = 10 * 1000;
        let waitInterval = 1000;
        do {
          await sleep(waitInterval).then(() => {
            getOtp(otpTime, mobile, email).then(
              function (value) {
                otp = value;
                waitLimit -= waitInterval;
              },
              function (reason) {
                throw `ERROR: ${reason}`;
              }
            );
          });
        } while (otp === '' && waitLimit > 0);
        if (otp === '') throw 'ERROR: can not retrieve OTP.';
        let by = _by(cmd.target);
        await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(otp);
            if (cmd.successMessage) {
              console.log(cmd.successMessage);
            }
            notifyCommandComplete();
          });
      } else {
        throw `ERROR: command value format is not valid.`;
      }
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _type(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'type',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let by = _by(cmd.target);
      await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
        .then(async function (elm) {
          let value = cmd.value || '';
          let m = value.match(/^\$\{([_a-z][_a-z0-9]*)\}$/);
          if (m) {
            value = SELENIUM_SESSION_VARS[m[1]];
          }
          await elm.click();
          await elm.sendKeys(value);
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _runScript(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'runScript',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      await driver.executeScript(cmd.target);
      if (cmd.successMessage) {
        console.log(cmd.successMessage);
      }
      notifyCommandComplete();
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _storeAttribute(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'storeAttribute',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let lastAt = cmd.target.lastIndexOf('@');
      if (lastAt == -1) {
        throw 'Target has not a valid format.';
      }
      let attrName = cmd.target.slice(lastAt + 1);
      if (cmd.value.match(/^[_a-z][_a-z0-9]*$/i) == null) {
        throw `Store variable "${cmd.value}" is not valid.`;
      }
      by = _by(cmd.target.slice(0, lastAt));
      await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
        .then(async function (elm) {
          let attrValue = await driver.executeScript(`return arguments[0].getAttribute("${attrName}");`, elm);
          setTestVars(cmd.value, attrValue);
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _verifyAttribute(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'verifyAttribute',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      let lastAt = cmd.target.lastIndexOf('@');
      if (lastAt == -1) {
        throw 'Target has not a valid format.';
      }
      let attrName = cmd.target.slice(lastAt + 1);
      let attrValue;
      by = _by(cmd.target.slice(0, lastAt));
      await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
        .then(async function (elm) {
          attrValue = await driver.executeScript(`return arguments[0].getAttribute("${attrName}");`, elm);
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
      return attrValue;
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _captureEntirePageScreenshot(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'captureEntirePageScreenshot',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    if (argv.cs === false) {
      return;
    }
    notifyCommandStart();
    try {
      await capturePage(cmd.target)
        .then(function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _waitForPageToLoad(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'waitForPageToLoad',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      await driver.wait(async function () {
        let readyState = await driver.executeScript('return document.readyState === \'complete\';');
        return readyState;
      }, SELENIUM_COMMAND_TIMEOUT)
        .then(function () {
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _mouseOver(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'mouseOver',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    try {
      by = _by(cmd.target);
      await driver.wait(until.elementLocated(by), SELENIUM_COMMAND_TIMEOUT)
        .then(async function (elm) {
          await driver.executeScript("arguments[0].scrollIntoView()", elm);
          if (cmd.successMessage) {
            console.log(cmd.successMessage);
          }
          notifyCommandComplete();
        });
    } catch (error) {
      if (cmd.errorMessage) {
        console.log(cmd.errorMessage);
      }
      throw error;
    }
  }

  async function _select(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'select',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
  }

  async function _echo(cmd) {
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'echo',
        target: cmd.target || '',
        value: cmd.value || '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    if (cmd.target) {
      console.log(cmd.target);
    }
  }

  async function _setWindowSize(cmd) {
    let m = typeof cmd.target === 'string' ? cmd.target.match(/^(\d+)x(\d+)$/) : null;
    if (m === null) {
      throw 'Wrong window size format.';
    }
    if (argv.gc || argv.gco) {
      test.commands.push({
        id: _uuid(),
        command: 'setWindowSize',
        target: cmd.target,
        value: '',
        successMessage: cmd.successMessage,
        errorMessage: cmd.errorMessage
      });
      if (argv.gco) {
        return;
      }
    }
    notifyCommandStart();
    await driver.manage().window().setRect({ x: 0, y: 0, width: parseInt(m[1]), height: parseInt(m[2]) });
    notifyCommandComplete();
  }

  async function setOutboundDate(flightDate, oneWay) {

    SELENIUM_TEST_VARS['_departureDate'] = `${flightDate}`;

    await _type({
      target: 'id=data-andata--prenota-desk',
      value: `${flightDate}`
    });

    await _echo({
      target: 'Typed in outbound date. Wait for calendar ...'
    });

    await _click({
      target: 'css=#ui-datepicker-div a.ui-state-default.ui-state-active',
      successMessage: 'Outbound date selected on calendar.'
    });

    if (oneWay) {

      await _echo({
        target: 'Wait to dismiss calendar ...'
      });

      await _waitForElementNotPresent({
        target: 'css=#ui-datepicker-div',
        successMessage: 'Calendar dismissed.'
      });

    }
  }

  async function setInboundDate(flightDate) {

    SELENIUM_TEST_VARS['_returnDate'] = `${flightDate}`;

    await _type({
      target: 'id=data-ritorno--prenota-desk',
      value: `${flightDate}`,
      successMessage: 'Typed in inbound date.'
    });

    await _echo({
      target: 'Wait for calendar widget ...'
    });

    await _click({
      target: 'css=#ui-datepicker-div a.ui-state-default.ui-state-active',
      successMessage: 'Inbound date clicked on calendar.'
    });

    await _echo({
      target: 'Wait to dismiss calendar ...'
    });

    await _waitForElementNotPresent({
      target: 'css=#ui-datepicker-div',
      successMessage: 'Calendar dismissed.'
    });
  }

  async function setDepartureCity(data) {

    SELENIUM_TEST_VARS['_from'] = `${data.departure.airport ? data.departure.airport : data.departure.city}`;

    await _type({
      target: 'xpath=//*[@class="cerca-volo"]//*[@class="partenza-destinazione"]//input[@type="text" and contains(@id,"partenza")]',
      value: `${data.departure.airport ? data.departure.airport : data.departure.city}`,
      successMessage: 'Typed in departure city / airport.'
    });

    await _echo({
      target: 'Wait for departure city / airport dropdown ...'
    });

    await _click({
      target: 'css=#suggestion_partenza--prenota-desk .autocomplete-suggestion',
      successMessage: 'Departure city / airport selected on dropdown.'
    });

    await _echo({
      target: 'Wait to dismiss departure city / airport dropdown ...'
    });

    await _waitForElementNotPresent({
      target: 'css=#suggestion_partenza--prenota-desk',
      successMessage: 'Departure city / airport dropdown dismissed.'
    });
  }

  async function setArrivalCity(data) {

    SELENIUM_TEST_VARS['_to'] = `${data.arrival.airport ? data.arrival.airport : data.arrival.city}`;

    await _type({
      target: 'id=luogo-arrivo--prenota-desk',
      value: `${data.arrival.airport ? data.arrival.airport : data.arrival.city}`,
      successMessage: 'Typed in arrival city / airport.'
    });

    await _echo({
      target: 'Wait for arrival city / airport dropdown ...'
    });

    await _click({
      target: 'css=#suggestion_ritorno--prenota-desk .autocomplete-suggestion',
      successMessage: 'Arrival city / airport selected on dropdown.'
    });

    await _echo({
      target: 'Wait to dismiss arrival city / airport dropdown ...'
    });

    await _waitForElementNotPresent({
      target: 'css=#suggestion_ritorno--prenota-desk',
      successMessage: 'Arrival city / airport dropdown dismissed.'
    });

  }

  async function runSearch(driver, data) {

    await _echo({
      target: 'Search travel solutions ...'
    });

    await _click({
      target: 'xpath=//*[@id="panel-travel-options" and contains(@style,"display: block")]//button[@value="cerca"]',
      successMessage: 'Search flight button clicked.'
    });

    if (data.disclaimer && data.disclaimer.confirm) {

      await _waitForCondition({
        target: 'return window.location.href.match("/booking/continuity-sardinia.html");',
        successMessage: 'Disclaimer page displayed.',
        errorMessage: 'Disclaimer page not found.'
      });

      if (data.disclaimer.confirm === 'YES') {
        await _click({
          target: 'xpath=//*[@class="buttonCover"]/a//descendant-or-self::*[.="Si"]',
          successMessage: 'Disclaimer confirmed.'
        });
      } else {
        await _click({
          target: 'xpath=//*[@class="buttonCover"]/a//descendant-or-self::*[.="No"]',
          successMessage: 'Disclaimer not confirmed.'
        });
      }
    }

    await _waitForCondition({
      target: 'return window.location.href.match("/booking/flight-select.html");',
      successMessage: 'Disclaimer page displayed.',
      errorMessage: 'Disclaimer page not found.'
    });

    await _waitForElementPresent({
      target: 'xpath=//*[contains(@class,"waitingPage ")]',
      successMessage: 'Flight search in progress.'
    });

    await _verifyAttribute({
      target: 'xpath=//*[contains(@class,"waitingPage ")]@style'
    }).then(async function (styleAttr) {
      if (styleAttr && styleAttr.match('display: block')) {
        await _waitForElementPresent({
          target: 'xpath=//*[contains(@class,"waitingPage ") and contains(@style,"display: none")]',
          successMessage: 'Flight search completed.'
        });
      }
    });

    await _assertNotLocation({
      target: '/booking/no-solutions.html',
      errorMessage: 'No travel solutions found.'
    });

    await _waitForElementPresent({
      target: 'xpath=//*[@id="booking-flight-select-selection"]/*[contains(@class,"bookingTable")]',
      successMessage: 'Flight search results displayed.'
    });

    await _captureEntirePageScreenshot({
      target: 'flight_search_results',
      successMessage: 'Captured travel solutions page.'
    });

    if (argv.gco === false) {
      await driver.sleep(2000);
    }

    await _click({
      target: `xpath=//*[contains(@class,"bookingTable")]//a[@data-type="${camelcase(data.outbound.bookingClass)}" and @data-details-route="0"]//*[@class="price"]`,
      successMessage: 'Outbound flight selected.'
    });

    SELENIUM_TEST_VARS['_class'] = `${data.outbound.bookingClass}`;
    
    await _waitForElementPresent({
      target: 'xpath=//*[contains(@class,"bookingTable") and @data-index-route="0"]/*[contains(@class,"bookingLoaderCover") and contains(@style,"display: none")]',
      successMessage: 'Outbound flight selection loader dismissed.'
    });

    await _click({
      target: 'xpath=//*[@class="bookingTable__rightButtonCover"]/a[contains(@class,"firstButton") and @data-details-route="0"]',
      successMessage: 'Outbound flight selection confirmed.'
    });

    await _waitForElementPresent({
      target: 'xpath=//*[@class="bookingRecap j-bookingRecapDep" and contains(@style,"display: block")]',
      successMessage: 'Outbound flight booked.'
    });

    if (data.inbound) {

      await _click({
        target: `xpath=//*[contains(@class,"bookingTable")]//a[@data-type="${camelcase(data.inbound.bookingClass)}" and @data-details-route="1"]//*[@class="price"]`,
        successMessage: 'Inbound flight selected.'
      });

      SELENIUM_TEST_VARS['_class'] = `${data.outbound.bookingClass}/${data.outbound.bookingClass}`;
      
      await _waitForElementPresent({
        target: 'xpath=//*[contains(@class,"bookingTable") and @data-index-route="1"]/*[contains(@class,"bookingLoaderCover") and contains(@style,"display: none")]',
        successMessage: 'Inbound flight selection loader dismissed.'
      });

      await _click({
        target: 'xpath=//*[@class="bookingTable__rightButtonCover"]/a[contains(@class,"firstButton") and @data-details-route="1"]',
        successMessage: 'Inbound flight selection confirmed.'
      });

      await _waitForElementPresent({
        target: 'xpath=//*[@class="bookingRecap j-bookingRecapRet" and contains(@style,"display: block")]',
        successMessage: 'Inbound flight booked.'
      });

    }

    await _waitForElementPresent({
      target: 'xpath=//*[@class="bookingRecap j-bookingRecapDep" and contains(@style,"display: block")]//*[contains(@class,"accordion") and contains(@style,"height: auto")]',
      successMessage: 'Outbound flight detail showed.'
    });

    if (data.inbound) {
      await _waitForElementPresent({
        target: 'xpath=//*[@class="bookingRecap j-bookingRecapRet" and contains(@style,"display: block")]//*[contains(@class,"accordion") and contains(@style,"height: auto")]',
        successMessage: 'Inbound flight detail showed.'
      });
    }

    /**
     * Enter PROMO CODE when present
     * 
     * Only one adult is allowed.
     * 
     * TBD. Add test on returned message.
     */

    if (data.promo.code) {

      await _click({
        target: 'xpath=//*[@id="ecoupon-container"]//a/span[@class="text" and text()="Codice Sconto"]'
      });

      await _type({
        target: 'xpath=//*[@id="ecoupon-container" and contains(@style,"height: auto")]//*[@id="form-ecoupon"]//*[@id="inputEcoupon"]',
        value: `${data.promo.code}`
      });

      await _click({
        target: 'xpath=//*[@id="ecoupon-container"]//*[@id="booking-dati-ecoupon-submit"]/span'
      });

      await _waitForElementPresent({
        target: `xpath=//*[@id="ecoupon-container" and contains(@style,"height: auto")]//*[@id="form-ecoupon"]//p[.="${data.promo.code}"]`,
        successMessage: `Promo code "${data.promo.code}" applied.`
      });

    }

    /**
     * Capture page
     */
    await _captureEntirePageScreenshot({
      target: 'booking_recap',
      successMessage: 'Captured booking recap.'
    });

    /**
     * Confirm selection
     */

    await _mouseOver({
      target: 'xpath=//*[@id="booking-flight-select-selection"]//a[contains(@class,"selectSubmit")]'
    });
    await _runScript({
      target: 'document.querySelector("#booking-flight-select-selection a.selectSubmit").click();',
      successMessage: 'Travel data confirmed.'
    });

    await fulfillPassengersAndContactsData();

    await fulfillAncillaryData();

    await fulfillPaymentData();

    async function fulfillPassengersAndContactsData() {

      await _waitForCondition({
        target: 'return window.location.href.match("/booking/passengers-data.html");',
        successMessage: 'Passengers data page displayed.',
        errorMessage: 'Passengers data page not found.'
      });

      await fulfillPassengersData();

      await fulfillContactsData();

      await fulfillAgreementsData();

      await _captureEntirePageScreenshot({
        target: 'passengers_data',
        successMessage: 'Captured travel options page.'
      });

      await _click({
        target: 'xpath=//form[@id="passengerDataForm"]//a[@id="datiPasseggeroSubmit"]'
      });
    }

    async function fulfillAgreementsData() {

      await _mouseOver({
        target: 'xpath=//form[@id="passengerDataForm"]//input[@id="checkAgreement"]'
      });

      await _runScript({
        target: 'document.querySelector("input#checkAgreement").click();'
      });

    }

    async function fulfillPassengersData() {

      await _echo({
        target: 'Waiting for passengers data form.'
      });

      await _waitForElementPresent({
        target: 'xpath=//form[@id="passengerDataForm"]',
        successMessage: 'Passengers data form found.'
      });

      await _echo({
        target: 'Fulfilling passengers data ...'
      });

      let arrPax = data.passengers.filter(function (p) {
        return p.type == "adult";
      });

      for (var i = 0; i < arrPax.length; i++) {

        let p = arrPax[i];

        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="nomeAdulto_${i + 1}"]`,
          value: `${p.firstName}`
        });
        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="cognomeAdulto_${i + 1}"]`,
          value: `${p.lastName}`
        });

        if (p.birthDate) {

          let birthDate = new moment(p.birthDate, 'DD/MM/YYYY');

          await _type({
            target: `xpath=//form[@id="passengerDataForm"]//input[@id="giorno_dataNascitaAdulto_${i + 1}"]`,
            value: `${birthDate.format('DD')}`
          });
          await _type({
            target: `xpath=//form[@id="passengerDataForm"]//input[@id="mese_dataNascitaAdulto_${i + 1}"]`,
            value: `${birthDate.format('MM')}`
          });
          await _type({
            target: `xpath=//form[@id="passengerDataForm"]//input[@id="anno_dataNascitaAdulto_${i + 1}"]`,
            value: `${birthDate.format('YYYY')}`
          });

        }

        if (p.gender) {
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="sessoAdulto_${i + 1}"]/option[@value="${p.gender}"]`
          });
        }

      }

      arrPax = data.passengers.filter(function (p) {
        return p.type == "child";
      });

      for (var i = 0; i < arrPax.length; i++) {

        let p = arrPax[i];

        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="nomeBambino_${i + 1}"]`,
          value: `${p.firstName}`
        });
        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="cognomeBambino_${i + 1}"]`,
          value: `${p.lastName}`
        });

        if (p.birthDate) {

          let birthDate = new moment(p.birthDate, 'DD/MM/YYYY');

          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="giorno_dataNascitaBambino_${i + 1}"]/option[@value="${birthDate.format('DD')}"]`
          });
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="mese_dataNascitaBambino_${i + 1}"]/option[@value="${birthDate.format('MM')}"]`
          });
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="anno_dataNascitaBambino_${i + 1}"]/option[@value="${birthDate.format('YYYY')}"]`
          });
        }

        if (p.gender) {
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="sessoBambino_${i + 1}"]/option[@value="${p.gender}"]`
          });
        }

      }

      arrPax = data.passengers.filter(function (p) {
        return p.type == "infant";
      });

      for (var i = 0; i < arrPax.length; i++) {

        let p = arrPax[i];

        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="nomeNeonato_${i + 1}"]`,
          value: `${p.firstName}`
        });
        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="cognomeNeonato_${i + 1}"]`,
          value: `${p.lastName}`
        });

        if (p.birthDate) {

          let birthDate = new moment(p.birthDate, 'DD/MM/YYYY');

          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="giorno_dataNascitaNeonato_${i + 1}"]/option[@value="${birthDate.format('DD')}"]`
          });
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="mese_dataNascitaNeonato_${i + 1}"]/option[@value="${birthDate.format('MM')}"]`
          });
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="anno_dataNascitaNeonato_${i + 1}"]/option[@value="${birthDate.format('YYYY')}"]`
          });
        }

        if (p.gender) {
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//select[@id="sessoNeonato_${i + 1}"]/option[@value="${p.gender}"]`
          });
        }

      }
    }

    async function fulfillContactsData() {

      await _echo({
        target: 'Fulfilling contacts data ...'
      });

      let cnts = [];
      cnts = data.contacts.filter(function (c) {
        return c.type == "email";
      });

      if (cnts.length > 0) {
        await _type({
          target: 'xpath=//form[@id="passengerDataForm"]//input[@id="email"]',
          value: `${cnts[0].email}`
        });
      }

      cnts = data.contacts.filter(function (c) {
        return c.type == "phone";
      });

      for (let i = 0; i < cnts.length; i++) {

        let cnt = cnts[i];

        if (i > 0) {
          await _click({
            target: `xpath=//form[@id="passengerDataForm"]//a[contains(@class,"bookingPassenger__addExtraContact")]`
          });
        }

        await _click({
          target: `xpath=//form[@id="passengerDataForm"]//select[@id="tipoRecapito_${i + 1}"]/option[.="${cnt.name}"]`
        });

        await _click({
          target: `xpath=//form[@id="passengerDataForm"]//select[@id="prefissoRecapito_${i + 1}"]/option[.="${cnt.prefix}"]`
        });

        await _type({
          target: `xpath=//form[@id="passengerDataForm"]//input[@id="valoreRecapito_${i + 1}"]`,
          value: `${cnt.number}`
        });
      }
    }

    async function fulfillAncillaryData() {

      await _waitForCondition({
        target: 'return window.location.href.match("/booking/ancillary.html");',
        successMessage: 'Ancillary page displayed.',
        errorMessage: 'Ancillary page not found.'
      });

      await _waitForElementPresent({
        target: 'xpath=//a[@id="ancillaryConfirm"]',
        successMessage: 'Ready to enter ancillary data.'
      });

      if (data.seats && data.seats.reserve) {
        await _click({
          target: 'xpath=//*[contains(@class,"upsellingTeaser")]//a'
        });
      }

      await _captureEntirePageScreenshot({
        target: 'ancillary',
        successMessage: 'Captured ancillary page.'
      });

      await _mouseOver({
        target: 'xpath=//a[@id="ancillaryConfirm"]'
      });

      await _runScript({
        target: 'document.querySelector("a#ancillaryConfirm").click();'
      });

      await _waitForCondition({
        target: 'return window.location.href.match("/booking/payment.html");',
        successMessage: 'Payment page displayed.',
        errorMessage: 'Payment page not found.'
      });

    }

    async function fulfillPaymentData() {

      if (typeof data.payment == 'undefined') {
        return;
      }

      await _assertLocation({
        target: '/booking/payment.html',
        errorMessage: 'Can not fulfill payment data. Not  payment page.'
      });

      await _waitForElementPresent({
        target: 'xpath=//*[contains(@class,"bookingPayment")]',
        successMessage: 'Payment options displayed'
      });

      if (data.payment.type == "card") {

        /*
        await _waitForElementPresent({
          target: `css=form#booking-acquista-cdc-form input[name="tipologiaCarta"][value="${data.payment.cardIssuer}"] + label`
        });
        */

        if (argv.gco === false) {
          await driver.sleep(2000);
        }

        await _click({
          target: `css=form#booking-acquista-cdc-form input[name="tipologiaCarta"][value="${data.payment.cardIssuer}"] + label`
        });
        /*
        await _runScript({
          target: `document.querySelector('form#booking-acquista-cdc-form input[name="tipologiaCarta"][value="${data.payment.cardIssuer}"] + label').click();` +
            `var elm = document.querySelector('form#booking-acquista-cdc-form .bookingPaymentForm__groupFieldset fieldset');` +
            `if (elm.className.indexOf('isActive') === -1) { elm.className = elm.className + ' isActive'; }`
        });
        */

        await _waitForElementPresent({
          target: 'css=form#booking-acquista-cdc-form .bookingPaymentForm__groupFieldset fieldset.isActive'
        });

        await _type({
          target: 'xpath=//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="numeroCarta"]',
          value: `${data.payment.cardNumber}`
        });

        await _type({
          target: 'xpath=//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="meseScadenza"]',
          value: `${data.payment.expiryMonth}`
        });

        await _type({
          target: 'xpath=//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="annoScadenza"]',
          value: `${data.payment.expiryYear}`
        });

        await _type({
          target: 'xpath=//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="cvc"]',
          value: `${data.payment.cvv}`
        });

        await _type({
          target: 'xpath=//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="nome"]',
          value: `${data.payment.accountHolderFirstName}`
        });

        await _type({
          target: 'xpath=//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="cognome"]',
          value: `${data.payment.accountHolderLastName}`
        });

        await _captureEntirePageScreenshot({
          target: 'payment_data',
          successMessage: 'Captured payment data page.'
        });

        await _click({
          target: 'xpath=//a[@id="booking-acquista-cdc-submit"]'
        });

        await _waitForCondition({
          target: 'return window.location.href.match("/booking/confirmation.html");',
          successMessage: 'Booking confirmation page displayed.',
          errorMessage: 'Booking confirmation page not found.'
        });

        await _waitForElementPresent({
          target: 'xpath=//*[@class="thankyoupage"]//*[contains(@class,"afterPayment")]',
          successMessage: 'Booking data displayed.'
        });

        await _storeText({
          target: 'css=.thankyoupage .afterPayment h1 span',
          value: '_pnr',
          successMessage: 'Captured PNR.'
        });

        await _captureEntirePageScreenshot({
          target: 'thank_you',
          successMessage: 'Captured thank you page.'
        });

      }
    }

  }

}

async function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

function _mkdirSync(dirPath) {
  try {
    fs.statSync(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(dirPath);
    }
  }
}

function _uuid() {
  return require('uuid/v1')();
}