
const { Builder, By, logging, until, Actions } = require('selenium-webdriver');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const moment = require('moment');
const camelcase = require('camelcase');
const dotenv = require('dotenv');

const firefox = require('selenium-webdriver/firefox');
const chrome = require('selenium-webdriver/chrome');

const width = 1280;
const height = 1024;

dotenv.config();

logging.installConsoleHandler();
logging.getLogger('webdriver.http').setLevel(logging.Level.ALL);

(async function B2CTest() {
  let data = JSON.parse(fs.readFileSync(process.env.SELENIUM_TEST_DATA, 'utf8'));
  for (let i = 0; i < data.length; i++) {
    await BookFlight(data[i]);
  }
})();

async function BookFlight(data) {
  let driver;
  let startTime;

  try {
    /**
     * Open browser
     */
    await startSession();

    /**
     * Start flight search
     */
    await startSearch();

    /**
     * Travel Type
     */
    await setTravelType(data.inbound == null);

    /**
     * Outbound flight
     */
    if (data.outbound) {
      await setOutboundData();
    }

    /**
     * Inbound flight
     */
    if (data.inbound) {
      await setInboundData();
    }

    /**
     * Travel options (passengers & booking class)
     */
    await fulfillTravelOptions();

    await capturePage('travel_options')
      .then(function () {
        console.log('Captured travel options page');
      });

    /**
     * Run flight search
     */
    await runSearch(driver, data);

  } catch (error) {
    if (driver) {
      await capturePage('error')
        .then(function () {
          console.log('Error occurred');
        });
    }
  } finally {
    if (driver) {
      capturesToPdf(data);
      await driver.quit()
        .then(function () {
          console.log('Web driver destroyed');
        });
    }
  }

  async function capturePage(captureTitle) {
    await driver.takeScreenshot().then(
      function (image, err) {
        let captureDir = `./browser_captures/${process.env.SELENIUM_BROWSER}/${startTime.format('YYYYMMDDHHmmSS')}`;
        try {
          fs.statSync(captureDir);
        } catch (err) {
          if (err.code === 'ENOENT') {
            fs.mkdirSync(captureDir);
          }
        }
        let captureCount = fs.readdirSync(captureDir).length + 1;
        let captureFile = `${captureDir}/${captureCount.toLocaleString(undefined, { minimumIntegerDigits: 2 })}_${captureTitle}.png`;
        fs.writeFileSync(captureFile, image, 'base64');
      }
    )
  }

  function capturesToPdf(data) {

    let captures_folder = `./browser_captures/${process.env.SELENIUM_BROWSER}/${startTime.format('YYYYMMDDHHmmSS')}`;

    fs.readdir(captures_folder, function (err, files) {
      if (files == 'undefined' || files.length == 0) {
        return;
      }
      let doc = new PDFDocument;

      doc.pipe(fs.createWriteStream(`${captures_folder}/${data.test.name}.pdf`));

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

  async function startSession() {

    console.log('Starting Test ...');

    startTime = moment();

    const SELENIUM_BROWSER_PROFILE_PATH = `${__dirname}/browser_profiles/${process.env.SELENIUM_BROWSER}/alitalia.selenium`;
    const SELENIUM_HEADLESS = process.env.SELENIUM_HEADLESS === undefined || process.env.SELENIUM_HEADLESS === 'true' ? true : false;

    let firefoxOptions = new firefox.Options()
      .setProfile(browserProfilePath)
      .windowSize({ width, height });

    let chromeOptions = new chrome.Options()
      .addArguments(`user-data-dir=${SELENIUM_BROWSER_PROFILE_PATH}`)
      .addArguments(`user-agent=${process.env.SELENIUM_BROWSER_USER_AGENT}`)
      .windowSize({ width, height });

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
        .enableVerboseLogging(true)
        .setStdio('inherit'))
      .setFirefoxOptions(firefoxOptions)
      .setChromeService(new chrome.ServiceBuilder()
        .enableVerboseLogging(true)
        .setStdio('inherit'))
      .setChromeOptions(chromeOptions)
      .build();

    console.log('Web driver created');
  }

  async function startSearch() {
    let by;
    await driver.get(process.env.SELENIUM_TARGET_URL)
      .then(function () {
        console.log('Alitalia Home Page showed.');
      });

    console.log('Wait for booking flight widget ...');
    by = By.xpath('//*[@class="cerca-volo"]//*[@id="booking-search"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Booking flight widget found.');
      });
  }

  async function setTravelType(oneWay) {
    let by;
    /**
     * Multitratta
     * URL: /booking/homepage-multitratta.html 
     */
    // //*[@class="cerca-volo"]//*[contains(@class,"multitratta")]/a



    console.log('Selecting travel type ...');
    if (oneWay) {
      by = By.css('fieldset > .input-wrap:nth-child(2) .placeholder');
    } else {
      by = By.css('fieldset > .input-wrap:nth-child(3) .placeholder');
    }
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log(`${oneWay ? "One way" : "Round trip"} travel selected.`);
      });

    await driver.sleep(2000);
  }

  async function setOutboundData() {
    await setDepartureCity(data.outbound);
    await setArrivalCity(data.outbound);
    await setOutboundDate(data.outbound.date, data.inbound == null);
  }

  async function setInboundData() {
    await setInboundDate(data.inbound.date);
  }

  async function fulfillTravelOptions() {

    console.log('Fulfilling travel options ...');

    let by;

    if (data.inbound == null) {

      by = By.xpath('//*[@id="validate_date"]/button');
      await driver.wait(until.elementLocated(by))
        .then(async function (elm) {
          await driver.wait(until.elementIsEnabled(elm), 60000);
          await elm.click();
        });
    }

    by = By.xpath('//*[@id="panel-travel-options" and contains(@style,"display: block")]');
    await driver.wait(until.elementLocated(by))
      .then(function () {
        console.log('Travel options panel displayed');
      });

    by = By.xpath('//*[@id="addAdults"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        let paxCount = data.passengers.filter(function (p) {
          return p.type == "adult";
        }).length;
        for (let i = 1; i < paxCount; i++) {
          await elm.click();
        }
      });

    by = By.xpath('//*[@id="addKids"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        let paxCount = data.passengers.filter(function (p) {
          return p.type == "child";
        }).length;
        for (let i = 0; i < paxCount; i++) {
          await elm.click();
        }
      });

    by = By.xpath('//*[@id="addBabies"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        let paxCount = data.passengers.filter(function (p) {
          return p.type == "infant";
        }).length;
        for (let i = 0; i < paxCount; i++) {
          await elm.click();
        }
      });
    _click('xpath=//*[@id="addBabies"]')
  }

  async function _click(locator, repeat) {

  }

  async function setOutboundDate(flightDate, oneWay) {
    let by;
    let el;
    by = By.id("data-andata--prenota-desk");
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        await elm.sendKeys(flightDate);
      });
    //el = await driver.findElement(by);
    //await el.click();
    //await el.sendKeys(flightDate);
    console.log('Typed in outbound date. Wait for calendar widget ...');
    by = By.css("#ui-datepicker-div a.ui-state-default.ui-state-active");
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log('Outbound date selected on calendar.');
      });
    //el = await driver.findElement(by);
    //await el.click();
    if (oneWay) {
      console.log('Dismiss calendar widget.');
      by = By.css("#ui-datepicker-div")
      el = await driver.findElement(by);
      await driver.wait(until.elementIsNotVisible(el), 60000)
        .then(function () {
          console.log('Calendar widget dismissed.');
        });
    }
  }

  async function setInboundDate(flightDate) {
    let by;
    let el;
    by = By.id("data-ritorno--prenota-desk");
    el = await driver.findElement(by);
    await el.click();
    await el.sendKeys(flightDate);
    console.log('Typed in inbound date.');
    console.log('Wait for calendar widget ...');
    by = By.css("#ui-datepicker-div a.ui-state-default.ui-state-active");
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Inbound date found on calendar.');
      });
    el = await driver.findElement(by);
    await el.click();
    console.log('Dismiss calendar widget.');
    await driver.wait(until.elementIsNotVisible(driver.findElement(By.css("#ui-datepicker-div"))), 60000)
      .then(function () {
        console.log('Calendar widget dismissed.');
      });
  }

  async function setDepartureCity(data) {
    let by;
    let el;
    console.log('Select departure city / airport.');

    by = By.xpath('//*[@class="cerca-volo"]//*[@class="partenza-destinazione"]//input[@type="text" and contains(@id,"partenza")]');
    await driver.wait(until.elementLocated(by))
      .then(async function (elm) {
        await elm.click();
        await elm.sendKeys(data.departure.airport ? data.departure.airport : data.departure.city);
        console.log('Typed in departure city / airport.');
      });

    console.log('Wait for departure city / airport dropdown ...');
    by = By.css("#suggestion_partenza--prenota-desk .autocomplete-suggestion");
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log('Departure city / airport dropdown found.');
      });


    console.log('Wait to dismiss departure city / airport dropdown ...');
    await driver.wait(until.elementIsNotVisible(driver.findElement(By.css('#suggestion_partenza--prenota-desk'))), 60000)
      .then(function () {
        console.log('Departure city / airport dropdown dismissed.');
      });
  }

  async function setArrivalCity(data) {
    let by;
    let el;
    console.log('Select arrival city / airport.');
    by = By.id("luogo-arrivo--prenota-desk");
    el = await driver.findElement(by);
    await el.click();
    await el.sendKeys(data.arrival.airport ? data.arrival.airport : data.arrival.city);
    console.log('Typed in arrival city / airport.');
    console.log('Wait for arrival city / airport dropdown ...');
    by = By.css("#suggestion_ritorno--prenota-desk .autocomplete-suggestion");
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Arrival city / airport dropdown found.');
      });
    el = await driver.findElement(by);
    await el.click();
    console.log('Wait to dismiss arrival city / airport dropdown ...');
    await driver.wait(until.elementIsNotVisible(driver.findElement(By.css('#suggestion_ritorno--prenota-desk'))), 60000)
      .then(function () {
        console.log('Arrival city / airport dropdown dismissed.');
      });
  }


  async function runSearch(driver, data) {
    let by;
    let el;
    /**
     * Flight search
     */
    console.log('Search flight ...');

    by = By.xpath('//*[@id="panel-travel-options" and contains(@style,"display: block")]//button[@value="cerca"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log('Search flight button clicked.');
      });

    await driver.wait(until.urlContains('/booking/flight-select.html'), 60000)
      .then(function () {
        console.log('Flight selection page displayed.');
      });

    by = By.xpath('//*[contains(@class,"waitingPage ") and contains(@style,"display: block")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Flight search in progress.');
      });

    by = By.xpath('//*[contains(@class,"waitingPage ") and contains(@style,"display: none")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Flight search completed.');
      });

    await driver.getCurrentUrl().then(function (currentUrl) {
      if (currentUrl.match('/booking/no-solutions.html')) {
        throw "No travel solutions found.";
      }
    });

    /**
     * Flight search results
     */
    by = By.xpath('//*[@id="booking-flight-select-selection"]/*[contains(@class,"bookingTable")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Flight search results displayed.');
      });

    await capturePage('flight_search_results')
      .then(function () {
        console.log('Captured travel options page');
      });

    by = By.xpath(`//*[contains(@class,"bookingTable")]//a[@data-type="${camelcase(data.outbound.bookingClass)}" and @data-details-route="0"]//*[@class="price"]`);
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log('Outbound flight selected.');
      });

    by = By.xpath('//*[contains(@class,"bookingTable") and @data-index-route="0"]/*[contains(@class,"bookingLoaderCover") and contains(@style,"display: none")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Outbound flight selection loader dismissed.');
      });

    by = By.xpath('//*[@class="bookingTable__rightButtonCover"]/a[contains(@class,"firstButton") and @data-details-route="0"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        console.log('Outbound flight detail displayed.');
        await elm.click();
      });

    by = By.xpath('//*[@class="bookingRecap j-bookingRecapDep" and contains(@style,"display: block")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Outbound flight booked.');
      });

    by = By.xpath(`//*[contains(@class,"bookingTable")]//a[@data-type="${camelcase(data.inbound.bookingClass)}" and @data-details-route="1"]//*[@class="price"]`);
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log('Inbound flight selected.');
      });

    by = By.xpath('//*[contains(@class,"bookingTable") and @data-index-route="1"]/*[contains(@class,"bookingLoaderCover") and contains(@style,"display: none")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Inbound flight selection loader dismissed.');
      });

    by = By.xpath('//*[@class="bookingTable__rightButtonCover"]/a[contains(@class,"firstButton") and @data-details-route="1"]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await elm.click();
        console.log('Inbound flight detail confirmed.');
      });

    by = By.xpath('//*[@class="bookingRecap j-bookingRecapRet" and contains(@style,"display: block")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Inbound flight booked.');
      });



    by = By.xpath('//*[@class="bookingRecap j-bookingRecapDep" and contains(@style,"display: block")]//*[contains(@class,"accordion") and contains(@style,"height: auto")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Outbound flight detail.');
      });


    by = By.xpath('//*[@class="bookingRecap j-bookingRecapRet" and contains(@style,"display: block")]//*[contains(@class,"accordion") and contains(@style,"height: auto")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(function () {
        console.log('Inbound flight detail.');
      });


    /**
     * Enter PROMO CODE when present
     * 
     * Only one adult is allowed.
     * 
     * TBD. Add test on returned message.
     */

    if (data.promo.code) {

      by = By.xpath('//*[@id="ecoupon-container"]//a/span[@class="text" and text()="Codice Sconto"]');
      await driver.wait(until.elementLocated(by), 60000)
        .then(async function (elm) {
          await elm.click();
        });

      by = By.xpath('//*[@id="ecoupon-container" and contains(@style,"height: auto")]//*[@id="form-ecoupon"]//*[@id="inputEcoupon"]');
      await driver.wait(until.elementLocated(by), 60000)
        .then(async function (elm) {
          await elm.click();
          await elm.sendKeys(data.promo.code);
        });

      by = By.xpath('//*[@id="ecoupon-container"]//*[@id="booking-dati-ecoupon-submit"]/span');
      await driver.wait(until.elementLocated(by), 60000)
        .then(async function (elm) {
          await elm.click();
        });

      by = By.xpath(`//*[@id="ecoupon-container" and contains(@style,"height: auto")]//*[@id="form-ecoupon"]//p[.="${data.promo.code}"]`);
      await driver.wait(until.elementLocated(by), 60000)
        .then(function (elm) {
          console.log(`Promo code "${data.promo.code}" applied.`);
        });

    }

    /**
     * Capture page
     */
    await capturePage('booking_recap')
      .then(function () {
        console.log('Captured booking recap.');
      });

    /**
     * Confirm selection
     */
    by = By.xpath('//*[@id="booking-flight-select-selection"]//a[contains(@class,"selectSubmit")]');
    await driver.wait(until.elementLocated(by), 60000)
      .then(async function (elm) {
        await driver.executeScript("arguments[0].scrollIntoView()", elm);
        await driver.executeScript('document.querySelector("#booking-flight-select-selection a.selectSubmit").click();');
        console.log('Travel data confirmed.');
      });

    await fulfillPassengersAndContactsData();

    await fulfillAncillaryData();

    await fulfillPaymentData();

    async function fulfillPassengersAndContactsData() {

      await driver.wait(until.urlContains('/passengers-data.html'), 60000)
        .then(function () {
          console.log('Passengers data page displayed.');
        });

      await fulfillPassengersData();

      await fulfillContactsData();

      await fulfillAgreementsData();

      await capturePage('passengers_data')
        .then(function () {
          console.log('Captured travel options page');
        });

      by = By.xpath(`//form[@id="passengerDataForm"]//a[@id="datiPasseggeroSubmit"]`);
      await driver.wait(until.elementLocated(by), 60000)
        .then(async function (elm) {
          await elm.click();
        });
    }

    async function fulfillAgreementsData() {

      by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="checkAgreement"]`);
      await driver.wait(until.elementLocated(by), 60000)
        .then(async function (elm) {
          //await elm.click();
          await driver.executeScript("arguments[0].scrollIntoView()", elm);
          await driver.executeScript('document.querySelector("input#checkAgreement").click();');
        });
    }

    async function fulfillPassengersData() {
      console.log('Waiting for passengers data form.');
      by = By.xpath('//form[@id="passengerDataForm"]');
      await driver.wait(until.elementLocated(by), 60000)
        .then(function () {
          console.log('Passengers data form found.');
        });
      console.log('Fulfilling passengers data ...');
      let arrPax = data.passengers.filter(function (p) {
        return p.type == "adult";
      });
      for (var i = 0; i < arrPax.length; i++) {
        let p = arrPax[i];
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="nomeAdulto_${i + 1}"]`);
        el = await driver.findElement(by);
        await el.click();
        await el.sendKeys(p.firstName);
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="cognomeAdulto_${i + 1}"]`);
        el = await driver.findElement(by);
        await el.click();
        await el.sendKeys(p.lastName);
      }
      arrPax = data.passengers.filter(function (p) {
        return p.type == "child";
      });
      for (var i = 0; i < arrPax.length; i++) {
        let p = arrPax[i];
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="nomeBambino_${i + 1}"]`);
        el = await driver.findElement(by);
        await el.click();
        await el.sendKeys(p.firstName);
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="cognomeBambino_${i + 1}"]`);
        el = await driver.findElement(by);
        await el.click();
        await el.sendKeys(p.lastName);
        let birthDate = new moment(p.birthDate, 'DD/MM/YYYY');
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="giorno_dataNascitaBambino_${i + 1}"]/option[@value="${birthDate.format('DD')}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="mese_dataNascitaBambino_${i + 1}"]/option[@value="${birthDate.format('MM')}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="anno_dataNascitaBambino_${i + 1}"]/option[@value="${birthDate.format('YYYY')}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="sessoBambino_${i + 1}"]/option[@value="${p.gender}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
      }
      arrPax = data.passengers.filter(function (p) {
        return p.type == "infant";
      });
      for (var i = 0; i < arrPax.length; i++) {
        let p = arrPax[i];
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="nomeNeonato_${i + 1}"]`);
        el = await driver.findElement(by);
        await el.click();
        await el.sendKeys(p.firstName);
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="cognomeNeonato_${i + 1}"]`);
        el = await driver.findElement(by);
        await el.click();
        await el.sendKeys(p.lastName);
        let birthDate = new moment(p.birthDate, 'DD/MM/YYYY');
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="giorno_dataNascitaNeonato_${i + 1}"]/option[@value="${birthDate.format('DD')}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="mese_dataNascitaNeonato_${i + 1}"]/option[@value="${birthDate.format('MM')}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="anno_dataNascitaNeonato_${i + 1}"]/option[@value="${birthDate.format('YYYY')}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="sessoNeonato_${i + 1}"]/option[@value="${p.gender}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
      }
    }

    async function fulfillContactsData() {
      console.log('Fulfilling contacts data ...');
      let cnts = [];
      cnts = data.contacts.filter(function (c) {
        return c.type == "email";
      });
      if (cnts.length > 0) {
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="email"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.sendKeys(cnts[0].email);
        });
      }
      cnts = data.contacts.filter(function (c) {
        return c.type == "phone";
      });
      for (let i = 0; i < cnts.length; i++) {
        const cnt = cnts[i];
        if (i > 0) {
          by = By.xpath(`//form[@id="passengerDataForm"]//a[contains(@class,"bookingPassenger__addExtraContact")]`);
          await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
            await elm.click();
          });
        }
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="tipoRecapito_${i + 1}"]/option[.="${cnt.name}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//select[@id="prefissoRecapito_${i + 1}"]/option[.="${cnt.prefix}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
        });
        by = By.xpath(`//form[@id="passengerDataForm"]//input[@id="valoreRecapito_${i + 1}"]`);
        await driver.wait(until.elementLocated(by), 60000).then(async function (elm) {
          await elm.click();
          await elm.sendKeys(cnt.number);
        });
      }
    }

    async function fulfillAncillaryData() {
      await driver.wait(until.urlContains('/ancillary.html'), 60000)
        .then(function () {
          console.log('Ancillary page displayed');
        });

      by = By.xpath(`//a[@id="ancillaryConfirm"]`);
      await driver.wait(until.elementLocated(by), 60000)
        .then(function () {
          console.log('Ready to enter ancillary data.');
        });

      if (data.seats && data.seats.reserve) {

        by = By.xpath('//*[contains(@class,"upsellingTeaser")]//a');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
          });

      }

      await capturePage('ancillary')
        .then(function () {
          console.log('Captured ancillary page.');
        });

      by = By.xpath(`//a[@id="ancillaryConfirm"]`);
      await driver.wait(until.elementLocated(by), 60000)
        .then(async function (elm) {
          await driver.executeScript("arguments[0].scrollIntoView()", elm);
          await driver.executeScript('document.querySelector("a#ancillaryConfirm").click();');
        });
    }

    async function fulfillPaymentData() {
      await driver.wait(until.urlContains('/payment.html'), 60000)
        .then(function () {
          console.log('Payment page displayed');
        });
      by = By.xpath(`//*[contains(@class,"bookingPayment")]`);
      await driver.wait(until.elementLocated(by), 60000)
        .then(function () {
          console.log('Payment options displayed');
        });
      if (data.payment.type == "card") {
        by = By.xpath(`//input[@name="tipologiaCarta" and @value="${data.payment.cardIssuer}"]/following-sibling::label`);
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
          });
        by = By.xpath('//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="numeroCarta"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(data.payment.cardNumber);
          });
        by = By.xpath('//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="meseScadenza"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(data.payment.expiryMonth);
          });
        by = By.xpath('//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="annoScadenza"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(data.payment.expiryYear);
          });
        by = By.xpath('//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="cvc"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(data.payment.cvv);
          });
        by = By.xpath('//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="nome"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(data.payment.accountHolderFirstName);
          });
        by = By.xpath('//*[@class="bookingPaymentForm__groupFieldset"]//input[@id="cognome"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
            await elm.sendKeys(data.payment.accountHolderLastName);
          });


        await capturePage('payment_data')
          .then(function () {
            console.log('Captured travel options page');
          });


        by = By.xpath('//a[@id="booking-acquista-cdc-submit"]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(async function (elm) {
            await elm.click();
          });


        by = By.xpath('//*[contains(@class,"waitingPage ") and contains(@style,"display: block")]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(function () {
            console.log('Flight search loader found.');
          });

        await driver.wait(until.urlContains('/booking/confirmation.html'), 60000)
          .then(function () {
            console.log('Booking confirmation psge displayed.');
          });

        by = By.xpath('//*[@class="thankyoupage"]//*[contains(@class,"afterpayment")]');
        await driver.wait(until.elementLocated(by), 60000)
          .then(function () {
            console.log('Booking data displayed.');
          });

      }
    }

  }

}
