import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

/**
 * СЕЛЕКТОРЫ WILDBERRIES
 */
const SELECTORS = {
    // ===== ПОИСК =====
    PRODUCT_CARD: "article.product-card",
    PRODUCT_LINK: "a.product-card__link",
    PRODUCT_BRAND: ".product-card__brand",
    PRODUCT_NAME: ".product-card__name",
    PRODUCT_PRICE: "ins.price__lower-price",
    PRODUCT_RATING: ".address-rate-mini",
    PRODUCT_REVIEWS: ".product-card__count",
    PRODUCT_IMAGE: "img.j-thumbnail",
    PRODUCT_ORIGINAL_MARK: "span.icon-original-check",

    // ===== ДЕТАЛЬНАЯ СТРАНИЦА =====
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

/**
 * Создание Chrome-драйвера
 */
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

    return new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();
}

/**
 * Формирование URL поиска с параметрами фильтрации
 * @param {string} query - поисковый запрос
 * @param {object} options - опции фильтрации
 * @returns {string} URL для запроса
 */
function buildSearchUrl(query, options = {}) {
    let url = `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`;
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('sort', 'popular');        // сортировка по умолчанию
    params.set('meta_charcs', 'false');

    // Цена (приходит в рублях, WB ожидает в копейках => умножаем на 100)
    if (options.minPrice !== undefined && options.maxPrice !== undefined) {
        const minKop = options.minPrice * 100;
        const maxKop = options.maxPrice * 100;
        params.set('priceU', `${minKop};${maxKop}`);
    }

    // Высокий рейтинг (от 4,7)
    if (options.highRating) {
        params.set('frating', '1');
    }

    // Оригинал
    if (options.isOriginal) {
        params.set('foriginal', '1');
    }

    // Премиум-продавец
    if (options.premiumSeller) {
        params.set('fpremium', '1');
    }

    return `${url}&${params.toString()}`;
}

/**
 * ПАРСЕР WILDBERRIES с фильтрацией (без сортировки)
 * @param {string} query - поисковый запрос
 * @param {object} options - параметры фильтрации
 * @param {number} maxProducts - максимальное количество товаров для детального сбора
 */
export async function parseWB(query, options = {}, maxProducts = 10) {
    // Если WB отключён в фильтрах – возвращаем пустой массив
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

        await driver.wait(
            until.elementLocated(By.css(SELECTORS.PRODUCT_CARD)),
            10000
        );

        /** 1️⃣ Карточки товаров */
        const cards = await driver.executeScript(
            (selectors, max) => {
                return Array.from(document.querySelectorAll(selectors.PRODUCT_CARD))
                    .slice(0, max)
                    .map(card => ({
                        brand: card.querySelector(selectors.PRODUCT_BRAND)?.innerText.trim() || "Н/Д",
                        title: (
                            card.querySelector(selectors.PRODUCT_NAME)?.innerText || ""
                        )
                            .replace(/^\s*\/\s*/, "")
                            .trim() || "Н/Д",
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

        /** 2️⃣ Детальный парсинг каждого товара */
        const products = [];

        for (let i = 0; i < cards.length; i++) {
            const base = cards[i];
            if (!base.link) continue;

            console.log(`🔗 [${i + 1}/${cards.length}] ${base.title.slice(0, 40)}…`);

            await driver.get(base.link);
            await driver.sleep(3000);

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
                // Категория
                const crumbs = Array.from(document.querySelectorAll(selectors.BREADCRUMBS_LIST));
                let category = "Н/Д";
                if (crumbs.length > 1) {
                    category = crumbs[1].querySelector(selectors.BREADCRUMB_TEXT)?.innerText.trim() || "Н/Д";
                }

                // Бренд
                const brandDetailed = document.querySelector(selectors.DETAIL_BRAND)?.innerText.trim() || null;

                // Продавец
                let seller = "Н/Д";
                let sellerRating = "Н/Д";

                const nameEl =
                    document.querySelector("[class*='sellerInfoName']") ||
                    document.querySelector("[class*='sellerInfoDefaultNameText']");

                if (nameEl) {
                    seller = nameEl.innerText
                        .replace(/\n/g, " ")
                        .replace(/\d+[.,]\d+/, "")
                        .trim();
                }

                const ratingEl = document.querySelector("[class*='sellerInfoRatingText']");
                if (ratingEl) {
                    sellerRating = ratingEl.innerText.replace(",", ".");
                }

                // Оригинальность на детальной странице
                const isOriginalDetailed = !!(
                    document.querySelector(selectors.ORIGINAL_BUTTON) ||
                    document.querySelector(selectors.ORIGINAL_ICON)
                );

                // Характеристики
                const characteristics = [];
                document.querySelectorAll(selectors.CHARACTERISTICS_ROWS).forEach(row => {
                    const value = row.querySelector(selectors.CHAR_VALUE)?.innerText.trim();
                    if (value) characteristics.push(value);
                });

                return {
                    category,
                    brandDetailed,
                    seller,
                    sellerRating,
                    isOriginalDetailed,
                    characteristics,
                };
            }, SELECTORS);

            products.push({
                name: base.title,
                price: parseInt(base.price.replace(/[^\d]/g, "")) || 0,
                rating: parseFloat(base.rating.replace(",", ".")) || 0,
                reviewsCount: parseInt(base.reviews.replace(/[^\d]/g, "")) || 0,
                imageUrl: base.imageUrl,
                link: base.link,

                brand: details.brandDetailed || base.brand,
                category: details.category,

                seller: details.seller,
                sellerRating: details.sellerRating,

                platform: "wb",
                isOriginal: base.isOriginal || details.isOriginalDetailed,

                characteristics: details.characteristics,
            });
        }

        return products;
    } catch (err) {
        console.error("❌ Ошибка Wildberries:", err.message);
        return [];
    } finally {
        await driver.quit();
    }
}