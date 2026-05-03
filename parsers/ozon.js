import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

/**
 * СЕЛЕКТОРЫ OZON (устойчивые)
 */
const SELECTORS = {
    PRODUCT_CARDS: "div.tile-root",
    PRODUCT_LINK: 'a.tile-clickable-element[href*="/product/"]',
    PRODUCT_TITLE: "a.tile-clickable-element span.tsBody500Medium",
    PRODUCT_PRICE: "span.tsHeadline500Medium",
    PRODUCT_IMAGE: "img",
    PRODUCT_RATING: 'span[style*="textPremium"]',
    PRODUCT_REVIEWS: 'span[style*="textSecondary"]',

    BREADCRUMBS: "[data-widget='breadCrumbs'] a span",
    SELLER_BLOCK: "[class*='pdp_m8']",
    CHARACTERISTICS: "dl.pdp_i5a",
};

/**
 * DRIVER
 */
async function createDriver() {
    const options = new chrome.Options();
    options.addArguments(
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1920,1080"
    );
    return new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();
}

/**
 * Формирование URL поиска Ozon с параметрами фильтрации и сортировки
 */
function buildSearchUrl(query, options = {}) {
    let url = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;
    const params = new URLSearchParams();
    params.set('category_was_predicted', 'true');
    params.set('deny_category_prediction', 'true');
    params.set('from_global', 'true');

    if (options.minPrice !== undefined && options.maxPrice !== undefined) {
        const minFormatted = `${options.minPrice}.000`;
        const maxFormatted = `${options.maxPrice}.000`;
        const priceRangeRaw = `${minFormatted};${maxFormatted}`;
        params.set('currency_price', priceRangeRaw);
    }
    if (options.highRating) params.set('is_high_rating', 't');
    if (options.isOriginal) params.set('brandcertified', 't');
    if (options.premiumSeller) params.set('is_high_rating_premium_seller', 't');

    if (options.sort) {
        const sortMap = {
            'popular': 'score',
            'cheap': 'price',
            'expensive': 'price_desc',
            'new': 'new'
        };
        const sortParam = sortMap[options.sort];
        if (sortParam) params.set('sorting', sortParam);
    }
    const paramsString = params.toString();
    return paramsString ? `${url}&${paramsString}` : url;
}

/**
 * ПАРСЕР OZON с параллельным детальным парсингом
 */
export async function parseOzon(query, options = {}, maxProducts = 10) {
    if (options.marketplaces && options.marketplaces.ozon === false) {
        console.log("⏩ Ozon пропущен (отключён в фильтрах)");
        return [];
    }

    const driver = await createDriver();
    const url = buildSearchUrl(query, options);
    console.log(`🔍 Ozon URL: ${url}`);

    try {
        await driver.get(url);
        await driver.sleep(4000);
        await driver.wait(until.elementLocated(By.css(SELECTORS.PRODUCT_CARDS)), 10000);
        let currentCards = await driver.findElements(By.css(SELECTORS.PRODUCT_CARDS));
        let currentCount = currentCards.length;
        let scrollAttempts = 0;
        const MAX_SCROLLS = 5;

        while (currentCount < maxProducts && scrollAttempts < MAX_SCROLLS) {
            await driver.executeScript("window.scrollTo(0, document.body.scrollHeight);");
            await driver.sleep(1500);
            const newCards = await driver.findElements(By.css(SELECTORS.PRODUCT_CARDS));
            const newCount = newCards.length;
            if (newCount === currentCount) break;
            currentCount = newCount;
            scrollAttempts++;
        }

        const cards = await driver.executeScript(
            (selectors, max) => {
                return Array.from(document.querySelectorAll(selectors.PRODUCT_CARDS))
                    .slice(0, max)
                    .map(card => {
                        const getText = sel => card.querySelector(sel)?.innerText.trim() || "";
                        const rawLink = card.querySelector(selectors.PRODUCT_LINK)?.href || "";
                        const cleanLink = rawLink.split("?")[0];
                        return {
                            name: getText(selectors.PRODUCT_TITLE),
                            price: getText(selectors.PRODUCT_PRICE).replace(/[^\d]/g, ""),
                            rating: getText(selectors.PRODUCT_RATING),
                            reviewsCount: getText(selectors.PRODUCT_REVIEWS).replace(/[^\d]/g, ""),
                            imageUrl: card.querySelector(selectors.PRODUCT_IMAGE)?.src || "",
                            link: cleanLink,
                        };
                    })
                    .filter(p => p.name && p.link);
            },
            SELECTORS,
            maxProducts
        );

        console.log(`📦 Найдено товаров: ${cards.length}`);
        const products = [];
        const BATCH_SIZE = 3;

        const fetchProductDetails = async (card) => {
            if (!card.link) return null;
            // Открываем новую вкладку
            await driver.switchTo().newWindow('tab');
            await driver.get(card.link);
            await driver.sleep(2500);

            const details = await driver.executeScript(selectors => {
                const breadcrumbs = Array.from(document.querySelectorAll(selectors.BREADCRUMBS))
                    .map(el => el.textContent.trim());
                const category = breadcrumbs[0] || "Н/Д";
                const brand = breadcrumbs[breadcrumbs.length - 1] || "Н/Д";

                let shopName = "Н/Д";
                let shopRating = "Н/Д";
                const sellerBlock = document.querySelector(selectors.SELLER_BLOCK);
                if (sellerBlock) {
                    const nameEl = sellerBlock.querySelector("span");
                    if (nameEl) shopName = nameEl.innerText.trim();
                    const ratingBlock = sellerBlock.querySelector("svg path[d*='M9.358']")?.closest("div");
                    if (ratingBlock) {
                        const text = ratingBlock.querySelector("span")?.innerText.trim();
                        if (/^\d+(\.\d+)?$/.test(text)) shopRating = text;
                    }
                    if (shopRating === "Н/Д") {
                        const spans = sellerBlock.querySelectorAll("span");
                        for (const el of spans) {
                            const text = el.innerText.trim();
                            if (/^\d+(\.\d+)?$/.test(text)) {
                                shopRating = text;
                                break;
                            }
                        }
                    }
                }

                let isOriginal = false;
                const brandBlock = document.querySelector("[data-widget='webBrand']");
                if (brandBlock && brandBlock.innerText.toLowerCase().includes("оригин")) isOriginal = true;
                if (document.querySelector("svg path[d*='M12 21c5.584']")) isOriginal = true;

                const characteristics = [];
                document.querySelectorAll(selectors.CHARACTERISTICS).forEach(dl => {
                    const val = dl.querySelector("dd")?.innerText.trim();
                    if (val) characteristics.push(val);
                });

                return { category, brand, shopName, shopRating, isOriginal, characteristics };
            }, SELECTORS);

            return {
                name: card.name,
                price: parseInt(card.price) || 0,
                rating: parseFloat(card.rating) || 0,
                reviewsCount: parseInt(card.reviewsCount) || 0,
                imageUrl: card.imageUrl,
                link: card.link,
                brand: details.brand,
                category: details.category,
                seller: details.shopName,
                sellerRating: details.shopRating,
                platform: "ozon",
                isOriginal: details.isOriginal,
                characteristics: details.characteristics,
            };
        };

        // Параллельная обработка порциями
        for (let i = 0; i < cards.length; i += BATCH_SIZE) {
            const batch = cards.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(card => fetchProductDetails(card)));
            // Закрываем все новые вкладки, кроме основной
            const handles = await driver.getAllWindowHandles();
            for (let j = 1; j < handles.length; j++) {
                await driver.switchTo().window(handles[j]);
                await driver.close();
            }
            await driver.switchTo().window(handles[0]);
            for (const res of batchResults) {
                if (res) products.push(res);
            }
        }

        return products;
    } catch (err) {
        console.error("❌ Ozon error:", err.message);
        return [];
    } finally {
        await driver.quit();
    }
}