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
    options.addArguments('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    return await new Builder().forBrowser('chrome').setChromeOptions(options).build();
}

export async function createOzonDriver() {
    return await createDriver();
}

export async function getOzonFilterHeaders(query, driver = null) {
    const ownDriver = !driver;
    if (ownDriver) driver = await createDriver();
    try {
        await driver.get('https://www.ozon.ru');
        await randomSleep(2000, 4000);
        const input = await driver.wait(until.elementLocated(By.css('input[name="text"]')), 15000);
        await input.click();
        await randomSleep(300, 700);
        await input.sendKeys(query);
        await randomSleep(500, 1200);
        const button = await driver.findElement(By.css('button[type="submit"]'));
        await button.click();
        await randomSleep(4000, 6000);
        await driver.wait(until.elementLocated(By.css('[data-widget="filtersDesktop"]')), 20000);
        console.log('filtersDesktop найден');
        await driver.executeScript(`window.scrollTo(0, 500);`);
        await randomSleep(1000, 2000);
        await driver.wait(async () => {
            const titles = await driver.findElements(By.css('span.ch_7, span.b6v_7'));
            return titles.length > 5;
        }, 15000);
        await randomSleep(1000, 2000);

        const headers = await driver.executeScript(() => {
            const excludeNames = new Set([
                'Цена', 'Распродажа', 'Оригинальный товар', 'Официальные магазины бренда',
                'Рассрочка', 'Баллы за отзывы', 'Сделано в России', 'Больше морковок от Захара',
                'Доставка', 'Рассрочка 0-0-6', 'Высокий рейтинг'
            ]);
            const result = [];
            const titleElements = document.querySelectorAll('span.ch_7, span.b6v_7');
            for (const el of titleElements) {
                let title = el.innerText?.trim();
                if (!title) continue;
                title = title.replace(/\s+/g, ' ').trim();
                if (excludeNames.has(title)) continue;
                if (title.length < 2 || title.length > 60) continue;
                if (result.some(x => x.name === title)) continue;
                result.push({
                    name: title,
                    key: title.toLowerCase().replace(/\s+/g, '_'),
                    platform: 'ozon'
                });
            }
            return result;
        });
        console.log('[Ozon] Заголовки фильтров:', headers.map(h => h.name));
        return headers;
    } finally {
        if (ownDriver) await driver.quit();
    }
}

export async function getOzonFilterValues(query, filterName, driver = null) {
    console.log(`🔍 Ozon: получаем значения для фильтра "${filterName}"`);
    const ownDriver = !driver;
    if (ownDriver) driver = await createDriver();

    try {
        if (ownDriver) {
            const url = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;
            await driver.get(url);
            await driver.wait(until.elementLocated(By.css('[data-widget="filtersDesktop"]')), 20000);
            await driver.sleep(3000);
        }

        let values = [];

        // Специальная обработка для цвета – через наведение
        if (filterName === "Цвет") {
            try {
                const colorBlock = await driver.findElement(
                    By.xpath("//span[contains(@class,'ch_7') and text()='Цвет']/ancestor::div[contains(@class,'ch0_7')]")
                );
                const colorIcons = await colorBlock.findElements(By.css('.vb4_7'));
                const colorNames = [];

                for (const icon of colorIcons) {
                    await driver.actions().move({ origin: icon }).perform();
                    await driver.sleep(500);

                    let tooltipText = null;
                    // Ищем тултип по точным классам
                    try {
                        const tooltip = await driver.findElement(By.css('.ea5_3_23-a6 .ea5_3_23-a8.ea5_3_23-a5'));
                        tooltipText = await tooltip.getText();
                    } catch (e) {
                        // fallback – ищем любой элемент с классом ea5_3_23-a6
                        try {
                            const tooltip = await driver.findElement(By.css('.ea5_3_23-a6'));
                            tooltipText = await tooltip.getText();
                        } catch (e2) {}
                    }

                    if (tooltipText && tooltipText.trim()) {
                        colorNames.push(tooltipText.trim());
                    }

                    await driver.actions().move({ x: 0, y: 0 }).perform();
                    await driver.sleep(200);
                }
                values = [...new Set(colorNames)];
                console.log(`🎨 Ozon цвета: ${values.join(', ')}`);
            } catch (err) {
                console.error('Ошибка парсинга цветов Ozon:', err);
                values = [];
            }
        } else {
            values = await driver.executeScript((filterName) => {
                const blocks = document.querySelectorAll('[data-widget="filtersDesktop"] .ch0_7');
                for (const block of blocks) {
                    const titleEl = block.querySelector('span.ch_7, .tsCompactControl500Medium');
                    if (!titleEl) continue;
                    const title = titleEl.innerText.trim();
                    if (title !== filterName) continue;
                    // Числовой слайдер
                    const rangeInput = block.querySelector('input[type="range"]');
                    if (rangeInput) {
                        return [rangeInput.min, rangeInput.max];
                    }
                    // Чекбоксы с текстом
                    const spans = block.querySelectorAll('span.tsBody500Medium');
                    const values = Array.from(spans).map(el => el.innerText.trim()).filter(Boolean);
                    return [...new Set(values)];
                }
                return [];
            }, filterName);
        }

        console.log(`📦 Ozon [${filterName}] найдено ${values.length} значений:`, values.slice(0, 15));
        return values;
    } finally {
        if (ownDriver) await driver.quit();
    }
}