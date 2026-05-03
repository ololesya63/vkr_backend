import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const SELECTORS = {
    PRODUCT_CARD: "article.product-card",
    PRODUCT_LINK: "a.product-card__link",
    PRODUCT_BRAND: ".product-card__brand",
    PRODUCT_NAME: ".product-card__name",
    PRODUCT_PRICE: "ins.price__lower-price",
    PRODUCT_RATING: ".address-rate-mini",
    PRODUCT_REVIEWS: ".product-card__count",
    PRODUCT_IMAGE: "img.j-thumbnail",
    PRODUCT_ORIGINAL_MARK: "span.icon-original-check",

    BREADCRUMBS_LIST: "ul.breadcrumbsList--KogkP li",
    BREADCRUMB_TEXT: "span.breadcrumbsLink--qbj2m",

    DETAIL_BRAND: "span.productHeaderBrandText--TfmLu",

    SELLER_NAME: "[class*='sellerInfoName']",
    SELLER_RATING: "[class*='sellerInfoRatingText']",

    ORIGINAL_BUTTON: "button.originalMark--ZeMYb",
    ORIGINAL_ICON: "svg path[d*='M10.8681']",

    CHARACTERISTICS_ROWS: "table.productOptionsTable--epyAr tr",
    CHAR_LABEL: "th",
    CHAR_VALUE: "td",
};

async function createDriver() {
    const options = new chrome.Options();
    options.addArguments(
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,900",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    );
    options.excludeSwitches(["enable-automation"]);
    return new Builder().forBrowser("chrome").setChromeOptions(options).build();
}

function buildSearchUrl(query, options = {}) {
    let url = `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`;
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('sort', options.sort ? options.sort : 'popular');
    params.set('meta_charcs', 'false');

    if (options.minPrice !== undefined && options.maxPrice !== undefined) {
        const minKop = options.minPrice * 100;
        const maxKop = options.maxPrice * 100;
        params.set('priceU', `${minKop};${maxKop}`);
    }
    if (options.highRating) params.set('frating', '1');
    if (options.isOriginal) params.set('foriginal', '1');
    if (options.premiumSeller) params.set('fpremium', '1');

    if (options.sort) {
        const sortMap = {
            'popular': 'popular',
            'cheap': 'priceup',
            'expensive': 'pricedown',
            'new': 'newly'
        };
        const sortParam = sortMap[options.sort];
        if (sortParam) params.set('sort', sortParam);
    }

    return `${url}&${params.toString()}`;
}

export async function parseWB(query, options = {}, maxProducts = 10) {
    if (options.marketplaces && options.marketplaces.wb === false) {
        console.log("⏩ WB пропущен (отключён в фильтрах)");
        return [];
    }

    const driver = await createDriver();
    const url = buildSearchUrl(query, options);
    console.log(`🔍 Wildberries URL: ${url}`);

    try {
        await driver.get(url);
        await driver.sleep(4000);
        await driver.wait(until.elementLocated(By.css(SELECTORS.PRODUCT_CARD)), 10000);

        const cards = await driver.executeScript(
            (selectors, max) => {
                return Array.from(document.querySelectorAll(selectors.PRODUCT_CARD))
                    .slice(0, max)
                    .map(card => ({
                        brand: card.querySelector(selectors.PRODUCT_BRAND)?.innerText.trim() || "Н/Д",
                        title: (card.querySelector(selectors.PRODUCT_NAME)?.innerText || "").replace(/^\s*\/\s*/, "").trim() || "Н/Д",
                        price: card.querySelector(selectors.PRODUCT_PRICE)?.innerText.trim() || "Н/Д",
                        rating: card.querySelector(selectors.PRODUCT_RATING)?.innerText.trim() || "Н/Д",
                        reviews: card.querySelector(selectors.PRODUCT_REVIEWS)?.innerText.trim() || "Н/Д",
                        link: card.querySelector(selectors.PRODUCT_LINK)?.href || "",
                        imageUrl: card.querySelector(selectors.PRODUCT_IMAGE)?.src || "",
                        isOriginal: !!card.querySelector(selectors.PRODUCT_ORIGINAL_MARK),
                    }));
            },
            SELECTORS,
            maxProducts
        );

        console.log(`📦 Найдено товаров: ${cards.length}`);

        const products = [];
        const BATCH_SIZE = 3; // количество одновременно открываемых вкладок

        // Асинхронная функция сбора деталей для одной карточки (открывает вкладку и заполняет данные)
        const fetchProductDetails = async (card) => {
            if (!card.link) return null;
            // Открываем новую вкладку
            await driver.switchTo().newWindow('tab');
            await driver.get(card.link);
            await driver.sleep(2000); // небольшая задержка, можно подобрать

            try {
                await driver.wait(async () => {
                    const el1 = await driver.findElements(By.css("[class*='sellerInfoWrap']"));
                    const el2 = await driver.findElements(By.css("[class*='sellerWrap']"));
                    const el3 = await driver.findElements(By.css("[class*='sellerInfoDefaultNameText']"));
                    return el1.length > 0 || el2.length > 0 || el3.length > 0;
                }, 7000);
            } catch {
                console.log("⚠️ seller блок не найден");
            }

            const details = await driver.executeScript(selectors => {
                const crumbs = Array.from(document.querySelectorAll(selectors.BREADCRUMBS_LIST));
                let category = "Н/Д";
                if (crumbs.length > 1) {
                    category = crumbs[1].querySelector(selectors.BREADCRUMB_TEXT)?.innerText.trim() || "Н/Д";
                }
                const brandDetailed = document.querySelector(selectors.DETAIL_BRAND)?.innerText.trim() || null;
                let seller = "Н/Д";
                let sellerRating = "Н/Д";
                const nameEl = document.querySelector("[class*='sellerInfoName']") ||
                    document.querySelector("[class*='sellerInfoDefaultNameText']");
                if (nameEl) {
                    seller = nameEl.innerText.replace(/\n/g, " ").replace(/\d+[.,]\d+/, "").trim();
                }
                const ratingEl = document.querySelector("[class*='sellerInfoRatingText']");
                if (ratingEl) {
                    sellerRating = ratingEl.innerText.replace(",", ".");
                }
                const isOriginalDetailed = !!(document.querySelector(selectors.ORIGINAL_BUTTON) ||
                    document.querySelector(selectors.ORIGINAL_ICON));
                const characteristics = [];
                document.querySelectorAll(selectors.CHARACTERISTICS_ROWS).forEach(row => {
                    const value = row.querySelector(selectors.CHAR_VALUE)?.innerText.trim();
                    if (value) characteristics.push(value);
                });
                return { category, brandDetailed, seller, sellerRating, isOriginalDetailed, characteristics };
            }, SELECTORS);

            // Возвращаем собранный объект
            return {
                name: card.title,
                price: parseInt(card.price.replace(/[^\d]/g, "")) || 0,
                rating: parseFloat(card.rating.replace(",", ".")) || 0,
                reviewsCount: parseInt(card.reviews.replace(/[^\d]/g, "")) || 0,
                imageUrl: card.imageUrl,
                link: card.link,
                brand: details.brandDetailed || card.brand,
                category: details.category,
                seller: details.seller,
                sellerRating: details.sellerRating,
                platform: "wb",
                isOriginal: card.isOriginal || details.isOriginalDetailed,
                characteristics: details.characteristics,
            };
        };

        // Обрабатываем карточки порциями
        for (let i = 0; i < cards.length; i += BATCH_SIZE) {
            const batch = cards.slice(i, i + BATCH_SIZE);
            // Открываем все вкладки для текущей партии и запускаем сбор
            const batchPromises = batch.map(card => fetchProductDetails(card));
            const batchResults = await Promise.all(batchPromises);
            // Закрываем все вкладки, кроме первой (исходной)
            const handles = await driver.getAllWindowHandles();
            // handles[0] — исходная вкладка со списком; остальные — открытые для парсинга
            for (let j = 1; j < handles.length; j++) {
                await driver.switchTo().window(handles[j]);
                await driver.close();
            }
            // Переключаемся обратно на исходную вкладку
            await driver.switchTo().window(handles[0]);
            // Добавляем успешные результаты
            for (const res of batchResults) {
                if (res) products.push(res);
            }
        }

        return products;
    } catch (err) {
        console.error("❌ Ошибка Wildberries:", err.message);
        return [];
    } finally {
        await driver.quit();
    }
}