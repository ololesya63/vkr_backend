import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

async function createDriver() {
    const options = new chrome.Options();
    options.addArguments("--headless", "--no-sandbox", "--disable-dev-shm-usage");
    return new Builder().forBrowser("chrome").setChromeOptions(options).build();
}

/**
 * Получение заголовков фильтров с Ozon.
 * Возвращает массив: { name, key, platform: 'ozon' }
 * key генерируется из имени (транслитерация, нижний регистр, замена пробелов на _).
 */
export async function getOzonFilterHeaders(query) {
    const driver = await createDriver();
    const url = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;
    try {
        await driver.get(url);
        await driver.wait(until.elementLocated(By.css('[data-widget="filtersDesktop"]')), 15000);

        const headers = await driver.executeScript(() => {
            const container = document.querySelector('[data-widget="filtersDesktop"]');
            if (!container) return [];

            const blocks = container.querySelectorAll('.ch0_7');
            const result = [];
            const excludeNames = new Set([
                'Цена', 'Распродажа', 'Оригинальный товар', 'Официальные магазины бренда',
                'Рассрочка', 'Баллы за отзывы', 'Сделано в России', 'Больше морковок от Захара',
                'Доставка'
            ]);

            for (const block of blocks) {
                let titleEl = block.querySelector('.b0w_7') || block.querySelector('.ch_7');
                if (!titleEl) continue;
                let name = titleEl.innerText.trim().replace(/\(.*?\)/, '').trim();
                if (!name || excludeNames.has(name)) continue;

                // Генерируем ключ из имени (латиница, нижний регистр, подчёркивания)
                const key = name.toLowerCase()
                    .replace(/[а-яё]/g, (c) => translitMap[c] || c)
                    .replace(/[^a-z0-9_]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '');
                result.push({ name, key, platform: 'ozon' });
            }
            return result;
        });
        return headers;
    } finally {
        await driver.quit();
    }
}

/**
 * Получение значений для конкретного фильтра Ozon по его имени.
 * Возвращает массив строк.
 */
export async function getOzonFilterValues(query, filterName) {
    const driver = await createDriver();
    const url = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;
    try {
        await driver.get(url);
        await driver.wait(until.elementLocated(By.css('[data-widget="filtersDesktop"]')), 15000);
        const values = await driver.executeScript((filterName) => {
            const blocks = document.querySelectorAll('.ch0_7');
            for (const block of blocks) {
                let titleEl = block.querySelector('.b0w_7') || block.querySelector('.ch_7');
                if (titleEl && titleEl.innerText.trim() === filterName) {
                    let valueSpans = block.querySelectorAll('.wb9_7 .bq03_5_3-a span');
                    if (valueSpans.length === 0) {
                        valueSpans = block.querySelectorAll('.checkbox__text, .radio__text');
                    }
                    return Array.from(valueSpans).map(el => el.innerText.trim());
                }
            }
            return [];
        }, filterName);
        return values;
    } finally {
        await driver.quit();
    }
}

// Простая таблица транслитерации для ключей (можно расширить)
const translitMap = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i',
    'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
    'у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
    'э':'e','ю':'yu','я':'ya'
};