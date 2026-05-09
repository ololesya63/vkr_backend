import { Builder, By, Key, until } from "selenium-webdriver";
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
        "--window-size=1920,1080",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--lang=ru-RU",
        "--log-level=3",
        "--silent",
    );
    options.addArguments("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    options.excludeSwitches(["enable-automation"]);

    return await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();
}

const randomSleep = (min = 800, max = 1500) =>
    new Promise(r => setTimeout(r, Math.random() * (max - min) + min));

async function navigateNaturally(driver, query) {
    await driver.get('https://www.ozon.ru');
    await randomSleep(2000, 4000);
    const input = await driver.wait(until.elementLocated(By.css('input[name="text"]')), 15000);
    await input.click();
    await randomSleep(300, 700);
    await input.sendKeys(query);
    await randomSleep(500, 1200);
    const searchBtn = await driver.findElement(By.css('button[type="submit"]'));
    await searchBtn.click();
    await randomSleep(4000, 6000);
}

/**
 * Формирование URL поиска Ozon с параметрами фильтрации
 * @param {string} query - поисковый запрос
 * @param {object} options - опции фильтрации
 * @returns {string} URL для запроса
 */
function buildSearchUrl(query, options = {}) {

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
        const priceRangeRaw = `${minFormatted};${maxFormatted}`;
        params.set('currency_price', priceRangeRaw);
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
    if (options.sort) {
        const sortMap = {
            'popular': 'score',            'cheap': 'price',
            'expensive': 'price_desc',
            'new': 'new'
        };
        const sortParam = sortMap[options.sort];
        if (sortParam) {
            params.set('sorting', sortParam);
        }
    }
    const paramsString = params.toString();
    return paramsString ? `${url}&${paramsString}` : url;
}

async function applyOzonDynamicFilters(driver, ozonDynamicFilters) {
    if (!ozonDynamicFilters?.length) return;
    const hasActive = ozonDynamicFilters.some(f =>
        (f.type === 'text' && f.values?.length > 0) ||
        (f.type === 'range' && (f.min != null || f.max != null))
    );
    if (!hasActive) return;

    try {
        await driver.wait(until.elementLocated(By.css('[data-widget="filtersDesktop"]')), 15000);
        const filtersWidget = await driver.findElement(By.css('[data-widget="filtersDesktop"]'));

        let allFiltersBtn = null;
        try {
            allFiltersBtn = await filtersWidget.findElement(By.css('button.b25_8_3-a4'));
        } catch {
            const buttons = await filtersWidget.findElements(By.css('button'));
            for (const btn of buttons) {
                const text = await btn.getText();
                if (text.toLowerCase().includes('фильтр')) { allFiltersBtn = btn; break; }
            }
        }
        if (!allFiltersBtn) { console.warn('⚠️ Ozon: кнопка "Все фильтры" не найдена'); return; }

        await driver.executeScript('arguments[0].click()', allFiltersBtn);
        await driver.sleep(2000);
        await driver.wait(until.elementLocated(By.css('.gc7_7')), 10000);
        await driver.sleep(1000);

        await driver.executeScript(() => {
            for (const row of document.querySelectorAll('.cg8_7')) {
                const header = row.querySelector('.g5c_7');
                if (header) header.click();
            }
        });
        await driver.sleep(1500);

        for (const filter of ozonDynamicFilters) {
            const filterRows = await driver.findElements(By.css('.cg8_7'));
            for (const row of filterRows) {
                try {
                    const nameEl = await row.findElement(By.css('.gc5_7 span'));
                    const name = await nameEl.getText();
                    if (name.trim().toLowerCase() !== filter.name.toLowerCase()) continue;

                    if (filter.type === 'text' && filter.values?.length > 0) {
                        const swatches = await row.findElements(By.css('.b4x_7'));
                        if (swatches.length > 0) {
                            // Цветовые свотчи: нужен hover чтобы узнать название
                            for (const swatch of swatches) {
                                try {
                                    await driver.actions().move({ origin: swatch }).perform();
                                    await driver.sleep(400);
                                    let tooltipText = null;
                                    try {
                                        const tooltip = await driver.findElement(By.css('.ea5_3_23-a6 .ea5_3_23-a8.ea5_3_23-a5'));
                                        tooltipText = await tooltip.getText();
                                    } catch {
                                        try {
                                            const tooltip = await driver.findElement(By.css('.ea5_3_23-a6'));
                                            tooltipText = await tooltip.getText();
                                        } catch {}
                                    }
                                    if (tooltipText && filter.values.some(v => v.toLowerCase() === tooltipText.trim().toLowerCase())) {
                                        await driver.executeScript('arguments[0].click()', swatch);
                                        await driver.sleep(300);
                                    }
                                    await driver.actions().move({ x: 0, y: 0 }).perform();
                                    await driver.sleep(150);
                                } catch {}
                            }
                        } else {
                            // Обычные чекбоксы с текстом
                            const spans = await row.findElements(By.css('span.tsBody500Medium'));
                            for (const span of spans) {
                                const text = (await span.getText()).trim();
                                if (filter.values.some(v => v.toLowerCase() === text.toLowerCase())) {
                                    await driver.executeScript('arguments[0].click()', span);
                                    await driver.sleep(300);
                                }
                            }
                        }
                    } else if (filter.type === 'range') {
                        const inputs = await row.findElements(By.css('input[type="number"], input[inputmode="numeric"]'));
                        if (inputs.length >= 2) {
                            if (filter.min != null) {
                                await inputs[0].clear();
                                await inputs[0].sendKeys(String(Math.round(filter.min)));
                            }
                            if (filter.max != null) {
                                await inputs[1].clear();
                                await inputs[1].sendKeys(String(Math.round(filter.max)));
                            }
                        }
                    }
                    break;
                } catch { /* секция не найдена, идём дальше */ }
            }
        }

        await driver.sleep(500);
        try {
            const applyBtn = await driver.findElement(By.css('div.g4c_7 button'));
            await driver.executeScript('arguments[0].click()', applyBtn);
            await driver.sleep(3000);
            await driver.wait(until.elementLocated(By.css(SELECTORS.PRODUCT_CARDS)), 10000);
        } catch {
            console.warn('⚠️ Ozon: кнопка "Применить" не найдена, продолжаем');
        }
    } catch (err) {
        console.warn('⚠️ Ozon dynamic filters error:', err.message);
    }
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
        const hasDynamicFilters = options.ozonDynamicFilters?.some(f =>
            (f.type === 'text' && f.values?.length > 0) ||
            (f.type === 'range' && (f.min != null || f.max != null))
        );

        if (hasDynamicFilters) {
            // Навигируем как человек, чтобы не триггерить антибот
            await navigateNaturally(driver, query);
            await applyOzonDynamicFilters(driver, options.ozonDynamicFilters);
        } else {
            await driver.get(url);
            await driver.sleep(4000);
        }

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
        const BATCH_SIZE = 3;

        const fetchProductDetails = async (base) => {
            if (!base.link) return null;

            const handlesBefore = await driver.getAllWindowHandles();

            try {
                const pathname = new URL(base.link).pathname;
                const titleEl = await driver.findElement(
                    By.css(`a.tile-clickable-element[href*="${pathname}"] span.tsBody500Medium`)
                );
                await driver.executeScript('arguments[0].scrollIntoView({block: "center"})', titleEl);
                await randomSleep(400, 800);
                await driver.actions().keyDown(Key.CONTROL).click(titleEl).keyUp(Key.CONTROL).perform();
                await randomSleep(800, 1500);
            } catch {
                // fallback: прямой переход если карточка не найдена
            }

            const handlesAfter = await driver.getAllWindowHandles();
            if (handlesAfter.length > handlesBefore.length) {
                await driver.switchTo().window(handlesAfter[handlesAfter.length - 1]);
            } else {
                await driver.switchTo().newWindow('tab');
                await randomSleep(500, 1000);
                await driver.get(base.link);
            }

            // Ждём хлебных крошек — признак что основной контент загружен
            try {
                await driver.wait(until.elementLocated(By.css(SELECTORS.BREADCRUMBS)), 10000);
            } catch { /* продолжаем даже если не появились */ }

            // Ждём загрузки блока продавца (подгружается позже основного контента)
            try {
                await driver.wait(until.elementLocated(By.css('[class*="pdp_m8"]')), 6000);
            } catch {
                console.warn(`⚠️ [Ozon] Блок продавца не загрузился: ${base.link}`);
            }

            const details = await driver.executeScript(selectors => {
                const breadcrumbs = Array.from(
                    document.querySelectorAll(selectors.BREADCRUMBS)
                ).map(el => el.textContent.trim());

                const category = breadcrumbs[0] || "Н/Д";
                const brand = breadcrumbs[breadcrumbs.length - 1] || "Н/Д";

                let shopName = "Н/Д";
                let shopRating = "Н/Д";

                // Имя продавца — span.b35_3_33-b7 содержит полный текст в DOM
                // (даже если CSS -webkit-line-clamp обрезает визуально)
                const sellerBlock = document.querySelector(selectors.SELLER_BLOCK);
                if (sellerBlock) {
                    const spans = sellerBlock.querySelectorAll('span.b35_3_33-b7');
                    for (const span of spans) {
                        const text = span.innerText.trim();
                        if (text && text !== 'Перейти') { shopName = text; break; }
                    }
                    // Запасной вариант если класс изменился
                    if (shopName === "Н/Д") {
                        for (const span of sellerBlock.querySelectorAll('span')) {
                            const text = span.innerText.trim();
                            if (text && text !== 'Перейти' && span.children.length === 0) {
                                shopName = text; break;
                            }
                        }
                    }
                }

                // Рейтинг продавца — span.tsCompactControl300XSmall в .pdp_an
                for (const el of document.querySelectorAll('.pdp_an span.tsCompactControl300XSmall')) {
                    const text = el.innerText.trim().replace(',', '.');
                    if (/^\d+(\.\d+)?$/.test(text)) { shopRating = text; break; }
                }

                let isOriginal = false;
                const brandBlock = document.querySelector("[data-widget='webBrand']");
                if (brandBlock && brandBlock.innerText.toLowerCase().includes("оригин")) isOriginal = true;
                if (document.querySelector("svg path[d*='M12 21c5.584']")) isOriginal = true;
                if (!isOriginal) {
                    const spans = document.querySelectorAll('.q6b3_4_1-a span');
                    for (const s of spans) {
                        if (s.innerText.toLowerCase().includes('оригинал')) { isOriginal = true; break; }
                    }
                }

                const characteristics = [];
                document.querySelectorAll(selectors.CHARACTERISTICS).forEach(dl => {
                    const val = dl.querySelector("dd")?.innerText.trim();
                    if (val) characteristics.push(val);
                });

                return { category, brand, shopName, shopRating, isOriginal, characteristics };
            }, SELECTORS);

            return {
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
            };
        };

        for (let i = 0; i < cards.length; i += BATCH_SIZE) {
            const batch = cards.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(card => fetchProductDetails(card)));

            const handles = await driver.getAllWindowHandles();
            for (let j = 1; j < handles.length; j++) {
                await driver.switchTo().window(handles[j]);
                await driver.close();
            }
            await driver.switchTo().window(handles[0]);

            for (const res of batchResults) {
                if (res) products.push(res);
            }

            if (i + BATCH_SIZE < cards.length) {
                await randomSleep(1000, 2000);
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