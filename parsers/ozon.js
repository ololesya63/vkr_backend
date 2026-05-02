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
 * Формирование URL поиска Ozon с параметрами фильтрации
 * @param {string} query - поисковый запрос
 * @param {object} options - опции фильтрации
 * @returns {string} URL для запроса
 */
function buildSearchUrl(query, options = {}) {
    // Базовый URL (можно использовать /search/, но лучше с категорией одежда/обувь, чтобы работали фильтры)
    let url = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;
    const params = new URLSearchParams();

    // Добавляем стандартные параметры, которые были в примерах
    params.set('category_was_predicted', 'true');
    params.set('deny_category_prediction', 'true');
    params.set('from_global', 'true');

    // Цена (приходит в рублях, Ozon ожидает строку вида "мин.000;макс.000" с тремя нулями?
    // Из примеров: currency_price=100.000%3B42500.000 – видимо, рублей с тремя десятичными знаками (копейки?).
    // Для простоты будем добавлять параметр currency_price с тремя нулями после точки.
    if (options.minPrice !== undefined && options.maxPrice !== undefined) {
        const minFormatted = `${options.minPrice}.000`;
        const maxFormatted = `${options.maxPrice}.000`;
        params.set('currency_price', `${minFormatted}%3B${maxFormatted}`);
    }

    // Высокий рейтинг (is_high_rating=t)
    if (options.highRating) {
        params.set('is_high_rating', 't');
    }

    // Оригинал (brandcertified=t)
    if (options.isOriginal) {
        params.set('brandcertified', 't');
    }

    // Премиум-продавец (is_high_rating_premium_seller=t)
    if (options.premiumSeller) {
        params.set('is_high_rating_premium_seller', 't');
    }

    const paramsString = params.toString();
    return paramsString ? `${url}&${paramsString}` : url;
}

/**
 * ПАРСЕР OZON с фильтрацией (без сортировки)
 * @param {string} query - поисковый запрос
 * @param {object} options - параметры фильтрации
 * @param {number} maxProducts - максимальное количество товаров
 */
export async function parseOzon(query, options = {}, maxProducts = 10) {
    // Если Ozon отключён в фильтрах – возвращаем пустой массив
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

        await driver.wait(
            until.elementLocated(By.css(SELECTORS.PRODUCT_CARDS)),
            10000
        );

        /** 1️⃣ Карточки */
        const cards = await driver.executeScript(
            (selectors, max) => {
                return Array.from(document.querySelectorAll(selectors.PRODUCT_CARDS))
                    .slice(0, max)
                    .map(card => {
                        const getText = sel =>
                            card.querySelector(sel)?.innerText.trim() || "";

                        const rawLink =
                            card.querySelector(selectors.PRODUCT_LINK)?.href || "";

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

        const products = [];

        /** 2️⃣ Детальная страница */
        for (let i = 0; i < cards.length; i++) {
            const base = cards[i];
            if (!base.link) continue;

            console.log(`🔗 [${i + 1}/${cards.length}] ${base.name.slice(0, 40)}…`);
            await driver.get(base.link);
            await driver.sleep(2500);

            const details = await driver.executeScript(selectors => {
                /** CATEGORY + BRAND */
                const breadcrumbs = Array.from(
                    document.querySelectorAll(selectors.BREADCRUMBS)
                ).map(el => el.textContent.trim());

                const category = breadcrumbs[0] || "Н/Д";
                const brand = breadcrumbs[breadcrumbs.length - 1] || "Н/Д";

                /** SELLER */
                let shopName = "Н/Д";
                let shopRating = "Н/Д";

                const sellerBlock = document.querySelector(selectors.SELLER_BLOCK);
                if (sellerBlock) {
                    const nameEl = sellerBlock.querySelector("span");
                    if (nameEl) {
                        shopName = nameEl.innerText.trim();
                    }

                    const ratingBlock = sellerBlock
                        .querySelector("svg path[d*='M9.358']")
                        ?.closest("div");

                    if (ratingBlock) {
                        const text = ratingBlock.querySelector("span")?.innerText.trim();
                        if (/^\d+(\.\d+)?$/.test(text)) {
                            shopRating = text;
                        }
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

                /** ORIGINAL */
                let isOriginal = false;
                const brandBlock = document.querySelector("[data-widget='webBrand']");
                if (brandBlock && brandBlock.innerText.toLowerCase().includes("оригин")) {
                    isOriginal = true;
                }
                if (document.querySelector("svg path[d*='M12 21c5.584']")) {
                    isOriginal = true;
                }

                /** CHARACTERISTICS */
                const characteristics = [];
                document.querySelectorAll(selectors.CHARACTERISTICS).forEach(dl => {
                    const val = dl.querySelector("dd")?.innerText.trim();
                    if (val) characteristics.push(val);
                });

                return {
                    category,
                    brand,
                    shopName,
                    shopRating,
                    isOriginal,
                    characteristics,
                };
            }, SELECTORS);

            products.push({
                name: base.name,
                price: parseInt(base.price) || 0,
                rating: parseFloat(base.rating) || 0,
                reviewsCount: parseInt(base.reviewsCount) || 0,
                imageUrl: base.imageUrl,
                link: base.link,
                brand: details.brand,
                category: details.category,
                seller: details.shopName,
                sellerRating: details.shopRating,
                platform: "ozon",
                isOriginal: details.isOriginal,
                characteristics: details.characteristics,
            });
        }

        return products;
    } catch (err) {
        console.error("❌ Ozon error:", err.message);
        return [];
    } finally {
        await driver.quit();
    }
}