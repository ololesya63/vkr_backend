import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const SLEEP_RANGE = { min: 800, max: 1500 };

const randomSleep = async (min = SLEEP_RANGE.min, max = SLEEP_RANGE.max) => {
    const ms = Math.random() * (max - min) + min;
    await new Promise(r => setTimeout(r, ms));
};

async function createDriver() {
    const options = new chrome.Options();

    options.addArguments(
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--disable-gpu',
        '--disable-dev-shm-usage'
    );

    options.addArguments(
        'user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    return await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

export async function getOzonFilterHeaders(query) {

    const driver = await createDriver();

    try {

        await driver.get('https://www.ozon.ru');

        await randomSleep(2000, 4000);

        // поиск как человек
        const input = await driver.wait(
            until.elementLocated(By.css('input[name="text"]')),
            15000
        );

        await input.click();

        await randomSleep(300, 700);

        await input.sendKeys(query);

        await randomSleep(500, 1200);

        const button = await driver.findElement(
            By.css('button[type="submit"]')
        );

        await button.click();

        // ждём загрузку выдачи

        await randomSleep(4000, 6000);

        // ждём фильтры
        await driver.wait(
            until.elementLocated(
                By.css('[data-widget="filtersDesktop"]')
            ),
            20000
        );
        console.log('10. filtersDesktop найден');
        // скроллим
        await driver.executeScript(`
            window.scrollTo(0, 500);
        `);
        await randomSleep(1000, 2000);

// Ждём, пока появятся все заголовки фильтров (хотя бы один)
        await driver.wait(async () => {
            const titles = await driver.findElements(By.css('span.ch_7, span.b6v_7'));
            return titles.length > 5; // ждём, когда станет >5 (цифру можно подобрать)
        }, 15000);

// Небольшая дополнительная пауза для подгрузки остальных
        await randomSleep(1000, 2000);

        const headers = await driver.executeScript(() => {

            const excludeNames = new Set([
                'Цена',
                'Распродажа',
                'Оригинальный товар',
                'Официальные магазины бренда',
                'Рассрочка',
                'Баллы за отзывы',
                'Сделано в России',
                'Больше морковок от Захара',
                'Доставка',
                'Рассрочка 0-0-6',
                'Высокий рейтинг'

            ]);

            const result = [];

            // ИЩЕМ ВСЕ ВОЗМОЖНЫЕ ЗАГОЛОВКИ
            const titleElements = document.querySelectorAll(`
        span.ch_7,
        span.b6v_7
    `);

            for (const el of titleElements) {

                let title = el.innerText?.trim();

                if (!title) continue;

                title = title.replace(/\s+/g, ' ').trim();

                if (excludeNames.has(title)) continue;

                if (title.length < 2 || title.length > 60) continue;

                // защита от дублей
                if (result.some(x => x.name === title)) continue;

                result.push({
                    name: title,
                    key: title
                        .toLowerCase()
                        .replace(/\s+/g, '_'),
                    platform: 'ozon'
                });
            }

            return result;

        });
        console.log(headers)
        return headers;

    } finally {
        await driver.quit();
    }
}
export async function getOzonFilterValues(query, filterName) {
    console.log(`🔍 Ozon: получаем значения для фильтра "${filterName}"`);
    const driver = await createDriver();

    try {

        const url = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;

        await driver.get(url);

        await driver.wait(
            until.elementLocated(By.css('[data-widget="filtersDesktop"]')),
            20000
        );

        await driver.sleep(3000);

        const values = await driver.executeScript((filterName) => {

            const blocks = document.querySelectorAll(
                '[data-widget="filtersDesktop"] .ch0_7'
            );

            for (const block of blocks) {

                const titleEl =
                    block.querySelector('span.ch_7') ||
                    block.querySelector('.tsCompactControl500Medium');

                if (!titleEl) continue;

                const title = titleEl.innerText.trim();

                if (title !== filterName) continue;

                const spans = block.querySelectorAll(
                    'span.tsBody500Medium'
                );

                const values = Array.from(spans)
                    .map(el => el.innerText.trim())
                    .filter(Boolean);

                return [...new Set(values)];
            }

            return [];

        }, filterName);
        console.log(`📦 Ozon: для фильтра "${filterName}" найдено значений: ${values.length}`, values.slice(0, 10));
        return values;

    } finally {
        await driver.quit();
    }
}