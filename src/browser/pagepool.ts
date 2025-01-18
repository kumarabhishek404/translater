import { type Browser, executablePath, type Page } from "puppeteer";
import puppeteer from "./puppeteer";

const { PUPPETEER_WS_ENDPOINT } = process.env;

export let pagePool: PagePool;

export default class PagePool {
  private _pages: Page[] = [];
  private _pagesInUse: Set<Page> = new Set();
  private _browser!: Browser;
  private _refreshInterval!: NodeJS.Timeout;

  constructor(private pageCount: number = 5) {
    pagePool = this;
  }

  public async init() {
    try {
      await this._initBrowser();
      await this._initPages();

      // Refresh pages periodically
      this._startPageRefresh(60 * 60 * 1000); // 1 hour
    } catch (error) {
      console.error("Error initializing PagePool:", error);
    }
  }

  public getPage(): Page | undefined {
    const page = this._pages.pop();
    if (page) {
      this._pagesInUse.add(page);
    }
    return page;
  }

  public releasePage(page: Page) {
    if (this._pagesInUse.has(page)) {
      this._pagesInUse.delete(page);
      this._pages.push(page);
    }
  }

  private async _initBrowser() {
    const launchOptions = {
      acceptInsecureCerts: true,
      headless: process.env.DEBUG !== "true",
      executablePath: 'executablePath()',
      userDataDir: "/tmp/translateer-data",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    };

    this._browser = PUPPETEER_WS_ENDPOINT
      ? await puppeteer.connect({ browserWSEndpoint: PUPPETEER_WS_ENDPOINT })
      : await puppeteer.launch(launchOptions);

    console.log("Browser launched");
  }

  private async _initPages() {
    console.log(`Initializing ${this.pageCount} pages...`);
    this._pages = (await Promise.all(
      Array.from({ length: this.pageCount }, async (_, i) => {
        try {
          const page = await this._browser.newPage();
          await this._setupPage(page, i);
          return page;
        } catch (error) {
          console.error(`Failed to create page ${i}:`, error);
          return null; // Allow partial initialization
        }
      }).filter((page) => page !== null)
    )) as Page[];
  }

  private async _setupPage(page: Page, index: number) {
    try {
      await page.setCacheEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (["image", "stylesheet", "font"].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      console.log(`Page ${index} created`);
      await page.goto("https://translate.google.com", {
        waitUntil: "networkidle2",
      });
      console.log(`Page ${index} loaded`);

      await this._handlePrivacyConsent(page, index);
      console.log(
        `Page ${index} ready (${this._pages.length + 1}/${this.pageCount})`
      );
    } catch (error) {
      console.error(`Error setting up page ${index}:`, error);
    }
  }

  private async _handlePrivacyConsent(page: Page, index: number) {
    try {
      const btnSelector = 'button[aria-label="Reject all"]';
      const isButtonVisible = await page.$(btnSelector);

      if (isButtonVisible) {
        await page.click(btnSelector);
        console.log(`Page ${index} privacy consent rejected`);
      } else {
        console.log(`Page ${index} privacy consent not required`);
      }
    } catch (error) {
      console.warn(`Privacy consent handling failed for page ${index}:`, error);
    }
  }

  private _startPageRefresh(ms: number) {
    this._refreshInterval = setInterval(async () => {
      console.log("Refreshing pages...");
      try {
        this._pagesInUse.clear();
        this._pages = [];
        await this._browser.close();
        await this._initBrowser();
        await this._initPages();
      } catch (error) {
        console.error("Error refreshing pages:", error);
      }
    }, ms);
  }

  public async shutdown() {
    clearInterval(this._refreshInterval);
    await Promise.all(this._pagesInUse);
    await this._browser.close();
    console.log("PagePool shut down");
  }
}
